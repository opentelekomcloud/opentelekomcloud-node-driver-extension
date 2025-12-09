/**
 * Helper class for dealing with the Open Telekom Cloud (OpenStack-based) APIs
 *
 * This is adapted from the Rancher OpenStack helper and extended with the
 * OTC-specific calls from the legacy Ember client.js:
 *  - listNodeFlavors
 *  - listNodeImages (IMS / cloudimages)
 *  - listVPCs / listSubnets
 *  - waitForVPCUp / createVPC
 *  - waitForSubnetUp / createSubnet
 *  - listKeyPairs
 *  - listSecurityGroups
 *  - listProjects
 *
 * All calls are proxied via Rancher meta proxy using management/request.
 */
export class OpenTelekomCloud {
  public domainName: string = '';
  public endpoint: string = '';
  public projectDomainName: string = '';
  public projectId: string = '';
  public projectName: string = '';
  public username: string = '';
  public password: string = '';
  public token: string = '';
  public region: string = '';
  private catalog: any;
  private endpoints: Record<string, string> = {};
  private userId: string = '';
  public vpcId: string = '';

  private $dispatch: any;

  public regionsFromCatalog: any[] = [];

  constructor($store: any, obj: any) {
    if (obj.annotations) {
      Object.keys(obj.annotations).forEach((key) => {
        const p = key.split('/');

        if (p.length === 2 && p[0] === 'opentelekomcloud.cattle.io') {
          const field = p[1];

          (this as any)[field] = obj.annotations[key];
        }
      });
    } else {
      // Copy from options to this
      Object.keys(obj).forEach((key) => {
        (this as any)[key] = obj[key];
      });
    }

    this.$dispatch = $store.dispatch;
  }

  /**
   * Authenticate using username/password and (optionally) project.
   * Populates this.token, this.userId and this.endpoints (nova, vpc, glance).
   */
  public async getToken() {
    const endpoint = this.endpoint.replace(/^https?:\/\//, '');
    const baseUrl = `/meta/proxy/${ endpoint }`;
    const url = `${ baseUrl }/auth/tokens`;

    const data: any = {
      auth: {
        identity: {
          methods:  ['password'],
          password: {
            user: {
              name:     this.username,
              domain:   { name: this.domainName },
              password: this.password
            }
          }
        }
      }
    };

    if (this.projectName) {
      // If projectName is set, scope to project
      data.auth.scope = {
        project: {
          name:   this.projectName,
          // projectDomainName is optional for OTC; if set, use it
          ...(this.projectDomainName ? { domain: { name: this.projectDomainName } } : {})
        }
      };
    } else {
      // Otherwise scope to domain
      data.auth.scope = {
        domain: { name: this.domainName }
      };
    }

    const headers = { Accept: 'application/json' };

    try {
      const res = await this.$dispatch('management/request', {
        url,
        headers,
        method:               'POST',
        redirectUnauthorized: false,
        data
      }, { root: true });

      if (res._status === 502) {
        return { error: 'Could not proxy request - URL may not be in Rancher\'s allow list' };
      }

      this.token = res._headers?.['x-subject-token'];
      this.userId = res?.token?.user?.id;

      this.regionsFromCatalog = [];

      if (res?.token && res.token.catalog) {
        this.catalog = res.token.catalog;
        this.endpoints = {};

        this.catalog.forEach((service: any) => {
          // OTC uses service.name values such as 'nova', 'vpc', 'glance'
          const endpointForRegion = (service.endpoints || []).find((ep: any) => ep.region === this.region);

          if (!endpointForRegion) {
            return;
          }

          switch (service.name) {
          case 'nova':
            this.endpoints.compute = endpointForRegion.url;
            break;
          case 'vpc':
            this.endpoints.vpc = endpointForRegion.url;
            break;
          case 'glance':
            this.endpoints.image = endpointForRegion.url;
            break;
          default:
            break;
          }

          if (endpointForRegion && service.name === 'nova') {
            if (!this.regionsFromCatalog.includes(endpointForRegion.region)) {
              this.regionsFromCatalog.push(endpointForRegion.region);
            }
          }
        });
      }

      this.regionsFromCatalog = this.regionsFromCatalog.map((id) => {
        return { id }
      });

      return res;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);

      return { error: e };
    }
  }

  public async getFlavors(value: any, initial?: string) {
    return await this.getComputeOptions(value, '/flavors', 'flavors', undefined, initial);
  }

  public async getImages(value: any, initial?: string) {
    return await this.getImageOptions(value, '/v2/cloudimages', 'images', undefined, initial);
  }

  public async getKeyPairs(value: any, initial?: string) {
    return await this.getComputeOptions(value, '/os-keypairs', 'keypairs', (v: any) => v.keypair, initial);
  }

  public async getSecurityGroups(value: any, initial?: string) {
    return await this.getComputeOptions(value, '/os-security-groups', 'security_groups', undefined, initial);
  }

  public async getFloatingIpPools(value: any, initial?: string) {
    return await this.getComputeOptions(value, '/os-floating-ip-pools', 'floating_ip_pools', undefined, initial);
  }

  public async getVpcs(value: any, initial?: string) {
    return await this.getVpcOptions(value, '/vpcs', 'vpcs', undefined, initial);
  }

  public async getSubnets(value: any, vpcId: string, initial?: string) {
    // Optionally remember the last VPC ID used
    this.vpcId = vpcId;
    return await this.getVpcOptions(
      value,
      `/subnets?vpc_id=${ encodeURIComponent(vpcId) }`,
      'subnets',
      undefined,
      initial
    );
  }

  public async getAvailabilityZones(value: any, initial?: string) {
    return await this.getComputeOptions(value, '/os-availability-zone', 'availabilityZoneInfo', (zone: any) => {
      return {
        ...zone,
        name: zone.zoneName
      };
    }, initial);
  }

  public async getImageOptions(value: any, api: string, field: string, mapper?: Function, initial?: string) {
    // We are fetching the data for the options
    value.busy = true;
    value.enabled = true;
    value.selected = '';

    const query = [
      'visibility=public',
      'protected=true',
      '__os_type=Linux',
      '__os_bit=64',
    ].join('&');

    const res = await this.makeImageRequest(api, `?${ query }`);

    if (res && (res as any)[field]) {
      let list = (res as any)[field] || [];

      if (mapper) {
        list = list.map((k: any) => mapper(k));
      }

      value.options = this.convertToOptions(list);
      value.busy = false;

      if (initial) {
        const found = value.options.find((option: any) => option.value.name === initial);

        if (found) {
          value.selected = found.value;
        }
      }

      if (!value.selected && value.options.length > 0) {
        value.selected = value.options[0].value;
      }
    } else {
      value.options = [];
      value.selected = null;
      value.busy = false;
      value.enabled = false;
    }
  }

  public async getComputeOptions(value: any, api: string, field: string, mapper?: Function, initial?: string) {
    // We are fetching the data for the options
    value.busy = true;
    value.enabled = true;
    value.selected = '';

    const res = await this.makeComputeRequest(api);

    if (res && (res as any)[field]) {
      let list = (res as any)[field] || [];

      if (mapper) {
        list = list.map((k: any) => mapper(k));
      }

      value.options = this.convertToOptions(list);
      value.busy = false;

      if (initial) {
        const found = value.options.find((option: any) => option.value.name === initial);

        if (found) {
          value.selected = found.value;
        }
      }

      if (!value.selected && value.options.length > 0) {
        value.selected = value.options[0].value;
      }
    } else {
      value.options = [];
      value.selected = null;
      value.busy = false;
      value.enabled = false;
    }
  }

  public async getVpcOptions(value: any, api: string, field: string, mapper?: Function, initial?: string) {
    // We are fetching the data for the options
    value.busy = true;
    value.enabled = true;
    value.selected = '';

    const res = await this.makeVpcRequest(api);

    if (res && (res as any)[field]) {
      let list = (res as any)[field] || [];

      if (mapper) {
        list = list.map((k: any) => mapper(k));
      }

      value.options = this.convertToOptions(list);
      value.busy = false;

      if (initial) {
        const found = value.options.find((option: any) => option.value.name === initial);

        if (found) {
          value.selected = found.value;
        }
      }

      if (!value.selected && value.options.length > 0) {
        value.selected = value.options[0].value;
      }
    } else {
      value.options = [];
      value.selected = null;
      value.busy = false;
      value.enabled = false;
    }
  }

  public async makeComputeRequest(api: string) {
    const endpoint = this.endpoints['compute']?.replace(/^https?:\/\//, '');
    if (!endpoint) {
      return { error: 'No compute endpoint discovered from catalog' };
    }

    const baseUrl = `/meta/proxy/${ endpoint }`;
    const url = `${ baseUrl }${ api }`;

    const headers = {
      Accept:         'application/json',
      'X-Auth-Token': this.token
    };

    try {
      return await this.$dispatch('management/request', {
        url,
        headers,
        method: 'GET',
        redirectUnauthorized: false,
      }, {root: true});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);

      return { error: e };
    }
  }

  private async makeVpcRequest(api: string, method = 'GET', body?: any) {
    console.log('[OTC] makeVpcRequest: api =', api, 'endpoints =', this.endpoints);

    const endpoint = this.endpoints['vpc']?.replace(/^https?:\/\//, '');
    console.log('[OTC] makeVpcRequest: ep =', endpoint);

    if (!endpoint) {
      console.error('[OTC] No VPC endpoint for region', this.region, 'catalog:', this.catalog);
      return null;    }

    const baseUrl = `/meta/proxy/${ endpoint }`;
    const url = `${ baseUrl }${ api }`;
    console.log('[OTC] makeVpcRequest: url =', url);

    const headers: any = {
      Accept:         'application/json',
      'X-Auth-Token': this.token
    };

    try {
      return await this.$dispatch('management/request', {
        url,
        headers,
        method: method,
        redirectUnauthorized: false,
      }, {root: true});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);

      return { error: e };
    }
  }

  private async makeImageRequest(api: string, queryString = '') {
    const endpoint = this.endpoints['image']?.replace(/^https?:\/\//, '');
    if (!endpoint) {
      return { error: 'No image (glance/IMS) endpoint discovered from catalog' };
    }

    const baseUrl = `/meta/proxy/${ endpoint }`;
    const url = `${ baseUrl }${ api }${ queryString }`;

    const headers: any = {
      Accept:         'application/json',
      'X-Auth-Token': this.token
    };

    try {
      return await this.$dispatch('management/request', {
        url,
        headers,
        method: 'GET',
        redirectUnauthorized: false,
      }, {root: true});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);

      return { error: e };
    }
  }

  /**
   * Generic Keystone-based project list used by OpenStack helper.
   * Kept for compatibility.
   */
  public async getProjects() {
    const endpoint = this.endpoint.replace(/^https?:\/\//, '');
    const baseUrl = `/meta/proxy/${ endpoint }`;

    const headers = {
      Accept:         'application/json',
      'X-Auth-Token': this.token
    };

    try {
      const res = await this.$dispatch('management/request', {
        url:                  `${ baseUrl }/users/${ this.userId }/projects`,
        headers,
        method:               'GET',
        redirectUnauthorized: false,
      }, { root: true });

      return res?.projects;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);

      return { error: e };
    }
  }

  // ---------------------------------------------------------------------------
  // OTC-specific "raw" calls adapted from legacy client.js
  // ---------------------------------------------------------------------------

  /**
   * Wait until VPC is available (status === 'OK').
   */
  public async waitForVPCUp(vpcId: string, endTime?: number): Promise<void> {
    const timeoutMs = 10 * 1000;

    if (!endTime) {
      endTime = Date.now() + timeoutMs;
    }

    if (Date.now() > endTime) {
      throw new Error('Timeout reached while waiting for VPC to become OK');
    }

    const res = await this.makeVpcRequest(`/vpcs/${ vpcId }`);

    const status = (res as any)?.vpc?.status;

    if (status === 'OK') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    return this.waitForVPCUp(vpcId, endTime);
  }

  /**
   * Create new VPC and wait until it is available.
   * Returns created VPC ID.
   */
  public async createVPC(name: string, cidr: string): Promise<string> {
    const body = {
      vpc: {
        name,
        cidr
      }
    };

    const res = await this.makeVpcRequest('/vpcs', 'POST', body);

    if ((res as any)?.vpc?.id) {
      const vpcId = (res as any).vpc.id;

      await this.waitForVPCUp(vpcId);

      return vpcId;
    }

    if ((res as any)?.error) {
      throw (res as any).error;
    }

    throw new Error('Failed to create VPC');
  }

  /**
   * Wait until subnet reaches status ACTIVE.
   */
  public async waitForSubnetUp(subnetId: string, endTime?: number): Promise<void> {
    const timeoutMs = 10 * 1000;

    if (!endTime) {
      endTime = Date.now() + timeoutMs;
    }

    if (Date.now() > endTime) {
      throw new Error('Timeout reached while waiting for Subnet to become ACTIVE');
    }

    const res = await this.makeVpcRequest(`/subnets/${ subnetId }`);

    const status = (res as any)?.subnet?.status;

    if (status === 'ACTIVE') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    return this.waitForSubnetUp(subnetId, endTime);
  }

  /**
   * Create new subnet instance and wait until it becomes ACTIVE.
   * Returns created subnet ID.
   */
  public async createSubnet(vpcId: string, name: string, cidr: string, gatewayIP: string): Promise<string> {
    // Default DNS list as in client.js
    const defaultDNS = ['100.125.4.25', '8.8.8.8'];

    const body = {
      subnet: {
        name,
        cidr,
        gateway_ip: gatewayIP,
        vpc_id:     vpcId,
        dnsList:    defaultDNS
      }
    };

    const res = await this.makeVpcRequest('/subnets', 'POST', body);

    if ((res as any)?.subnet?.id) {
      const subnetId = (res as any).subnet.id;

      await this.waitForSubnetUp(subnetId);

      return subnetId;
    }

    if ((res as any)?.error) {
      throw (res as any).error;
    }

    throw new Error('Failed to create Subnet');
  }

  private convertToOptions(list: any) {
    const sorted = (list || []).sort((a: any, b: any) => a.name.localeCompare(b.name));

    const options = sorted.map((p: any) => {
      return {
        label: p.name,
        value: p
      };
    });

    // Prepend an empty option so dropdowns can have and select a blank value
    return [
      {
        label: '-- EMPTY --',
        value: null
      },
      ...options
    ];
  }
}

<script>
import Loading from '@shell/components/Loading';
import {Banner} from '@components/Banner';
import CreateEditView from '@shell/mixins/create-edit-view';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import {LabeledInput} from '@components/Form/LabeledInput';
import {NORMAN, SECRET} from '@shell/config/types';
import {stringify} from '@shell/utils/error';
import {_VIEW} from '@shell/config/query-params';
import FileSelector from '../components/FileSelector';
import {OpenTelekomCloud} from '../opentelekomcloud.ts';

function initOptions() {
  return {
    options:  [],
    selected: null,
    busy:     false,
    enabled:  false,
  };
}

export default {
  components: {
    Banner, FileSelector, Loading, LabeledInput, LabeledSelect
  },

  mixins: [CreateEditView],

  props: {
    uuid: {
      type:     String,
      required: true,
    },

    cluster: {
      type:    Object,
      default: () => ({})
    },

    credentialId: {
      type:     String,
      required: true,
    },

    disabled: {
      type:    Boolean,
      default: false
    },

    busy: {
      type:    Boolean,
      default: false
    },

    provider: {
      type:     String,
      required: true,
    }
  },

  async fetch() {
    this.errors = [];
    if ( !this.credentialId ) {
      return;
    }

    if (this.mode === _VIEW) {
      this.initForViewMode();

      return;
    }

    try {
      this.credential = await this.$store.dispatch('rancher/find', { type: NORMAN.CLOUD_CREDENTIAL, id: this.credentialId });
    } catch (e) {
      this.credential = null;
    }

    // Populate basic auth fields from the cloud credential config (without password)
    const credCfg = this.credential?.opentelekomcloudcredentialConfig || {};
    this.username = credCfg.username || '';
    this.domainName = credCfg.domainName || '';
    this.projectName = credCfg.projectName || '';
    this.region = credCfg.region || '';
    this.endpoint = credCfg.authUrl || '';

    // Try and get the secret for the Cloud Credential as we need the plain-text password
    try {
      const id = this.credentialId.replace(':', '/');
      const secret = await this.$store.dispatch('management/find', { type: SECRET, id });
      const credPassword = secret.data['opentelekomcloudcredentialConfig-password'];

      if (credPassword) {
        this.password = atob(credPassword);
        this.havePassword = true;
      } else {
        this.password = '';
        this.havePassword = false;
      }

      this.ready = true;
    } catch (e) {
      // this.credential = null;
      this.password = '';
      this.havePassword = false;
      console.error(e); // eslint-disable-line no-console
    }

    this.authenticating = true;

    const otc = new OpenTelekomCloud(this.$store, {
      endpoint:   this.endpoint,
      domainName: this.domainName,
      username:   this.username,
      password:   this.password,
      projectName: this.projectName,
      region:     this.region,
    });

    this.otc = otc;

    // Fetch a token - if this succeeds, kick off async fetching the lists we need
    this.otc.getToken().then((res) => {
      console.log('[OTC] getToken result:', res);

      if (res.error) {
        this.authenticating = false;
        this.$emit('validationChanged', false);

        this.errors.push('Unable to authenticate with the OpenTelekomCloud server');

        return;
      }

      this.authenticating = false;

      console.log('[OTC] Before getFlavors, endpoints:', this.otc); // важно: посмотреть this.otc.endpoints

      otc.getFlavors(this.flavors, this.value?.flavorName);
      otc.getImages(this.images, this.value?.imageName);
      otc.getKeyPairs(this.keyPairs, this.value?.keypairName);
      otc.getSecurityGroups(this.securityGroups, this.value?.secGroups);
      otc.getFloatingIpPools(this.floatingIpPools, this.value?.floatingipPool);
      otc.getVpcs(this.vpcs, this.value?.vpcName);
      if (this.value?.vpcId) {
        otc.getSubnets(this.subnets, this.value.vpcId);
      }
      otc.getAvailabilityZones(this.availabilityZones, this.value?.availabilityZone);
    });

    this.$emit('validationChanged', false);
  },

  data() {
    return {
      authenticating:      false,
      ready:               false,
      otc:                 null,
      username:            '',
      endpoint:            '',
      domainName:          '',
      projectName:         '',
      region:              '',
      password:            null,
      havePassword:        false,
      flavors:             initOptions(),
      images:              initOptions(),
      keyPairs:            initOptions(),
      securityGroups:      initOptions(),
      floatingIpPools:     initOptions(),
      vpcs:                initOptions(),
      subnets:             initOptions(),
      availabilityZones:   initOptions(),
      sshUser:             this.value?.sshUser || 'ubuntu',
      privateKeyFile:      this.value?.privateKeyFile || '',
      filename:            this.value?.privateKeyFile ? 'Private Key Provided' : '',
      privateKeyFieldType: 'password',
      errors:              null,
    };
  },

  watch: {
    'credentialId'() {
      this.$fetch();
    },
    'vpcs.selected'(newVpc) {
      if (newVpc && newVpc.id && this.otc) {
        // Enable subnets and load them for the selected VPC
        this.subnets.enabled = true;
        this.otc.getSubnets(this.subnets, newVpc.id);
      } else {
        // No VPC selected: clear and disable subnets
        this.subnets.enabled = false;
        this.subnets.options = [];
        this.subnets.selected = null;
      }
    },
  },

  methods: {
    stringify,

    initForViewMode() {
      this.fakeSelectOptions(this.flavors, this.value?.flavorName);
      this.fakeSelectOptions(this.images, this.value?.imageName);
      this.fakeSelectOptions(this.keyPairs, this.value?.keypairName);
      this.fakeSelectOptions(this.securityGroups, this.value?.secGroups);
      this.fakeSelectOptions(this.floatingIpPools, this.value?.floatingipPool);
      this.fakeSelectOptions(this.vpcs, this.value?.vpcName);
      this.fakeSelectOptions(this.subnets, this.value?.subnetName);
      this.fakeSelectOptions(this.availabilityZones, this.value?.availabilityZone);
    },

    fakeSelectOptions(list, value) {
      list.busy = false;
      list.enabled = false;
      list.options = [];

      if (value) {
        list.options.push({
          label: value,
          value,
        });
      }

      list.selected = value;
    },

    onPrivateKeyFileSelected(v) {
      this.filename = v.file.name;
      this.privateKeyFile = v.data;

      // On initial load, filename is shown as a password as we don't know what the filename was that was used - we just want to indicate there is a vlue
      // When a file is chosen, change the type to text, so that the user can see the filename of the file that they chose
      this.privateKeyFieldType = 'text';

      this.$emit('validationChanged', true);
    },

    syncValue() {
      // Copy auth values from the Cloud Credential into the machine config, so they are
      // passed as flags (opentelekomcloud-*) to the docker-machine driver.
      // These fields are not shown in the UI, but are required for the driver to authenticate.
      this.value.authUrl = this.endpoint;
      this.value.domainName = this.domainName;
      this.value.username = this.username;
      this.value.projectName = this.projectName;
      this.value.region = this.region;

      if (this.havePassword && this.password) {
        this.value.password = this.password;
      }
      // Copy the values from the form to the correct places on the value
      this.value.availabilityZone = this.availabilityZones.selected?.name;
      this.value.flavorName = this.flavors.selected?.name;
      this.value.imageName = this.images.selected?.name;
      this.value.floatingipPool = this.floatingIpPools.selected?.name;
      this.value.keypairName = this.keyPairs.selected?.name;
      this.value.vpcName = this.vpcs.selected?.name;
      this.value.vpcId = this.vpcs.selected?.id;
      this.value.subnetName = this.subnets.selected?.name;
      this.value.secGroups = this.securityGroups.selected?.name;
      this.value.sshUser = this.sshUser;
      this.value.privateKeyFile = this.privateKeyFile;

      // Not configurable
      this.value.endpointType = 'publicURL';
      this.value.insecure = true;
      this.value.bootFromVolume = false;
      this.value.sshPort = '22';
    },

    test() {
      this.syncValue();
    }
  }
};
</script>

<template>
  <div>
    <Loading
        v-if="$fetchState.pending"
        :delayed="true"
    />
    <div v-if="errors.length">
      <div
          v-for="(err, idx) in errors"
          :key="idx"
      >
        <Banner
            color="error"
            :label="stringify(err)"
        />
      </div>
    </div>
    <div>
      <div class="opentelekomcloud-config">
        <div class="title">
          OpenTelekomCloud Configuration
        </div>
        <div
            v-if="authenticating"
            class="loading"
        >
          <i class="icon-spinner icon-spin icon-lg" />
          <span>
            Authenticating with the OpenTelekomCloud server ...
          </span>
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
              v-model:value="flavors.selected"
              label="Flavor"
              :options="flavors.options"
              :disabled="!flavors.enabled || busy"
              :loading="flavors.busy"
              :searchable="false"
          />
        </div>

        <div class="col span-6">
          <LabeledSelect
              v-model:value="images.selected"
              label="Image"
              :options="images.options"
              :disabled="!images.enabled || busy"
              :loading="images.busy"
              :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
              v-model:value="keyPairs.selected"
              label="Key Pair"
              :options="keyPairs.options"
              :disabled="!keyPairs.enabled || busy"
              :loading="keyPairs.busy"
              :searchable="false"
          />
        </div>
        <div class="col span-6">
          <LabeledInput
              v-model:value="filename"
              label="Private Key"
              :mode="mode"
              :type="privateKeyFieldType"
              :disabled="busy"
              :required="true"
          >
            <template v-slot:suffix>
              <div class="file-button">
                <FileSelector
                    label="..."
                    :mode="mode"
                    :include-file="true"
                    :disabled="busy"
                    class="btn-sm"
                    @selected="onPrivateKeyFileSelected"
                />
              </div>
            </template>
          </LabeledInput>
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
              v-model:value="securityGroups.selected"
              label="Security Groups"
              :options="securityGroups.options"
              :disabled="!securityGroups.enabled || busy"
              :loading="securityGroups.busy"
              :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
              v-model:value="availabilityZones.selected"
              label="Availability Zone"
              :options="availabilityZones.options"
              :disabled="!availabilityZones.enabled || busy"
              :loading="availabilityZones.busy"
              :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
              v-model:value="floatingIpPools.selected"
              label="Floating IP Pools"
              :options="floatingIpPools.options"
              :disabled="!floatingIpPools.enabled || busy"
              :loading="floatingIpPools.busy"
              :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
              v-model:value="vpcs.selected"
              label="VPCs"
              :options="vpcs.options"
              :disabled="!vpcs.enabled || busy"
              :loading="vpcs.busy"
              :searchable="false"
          />
        </div>
        <div class="col span-6">
          <LabeledSelect
              v-model:value="subnets.selected"
              label="Subnets"
              :options="subnets.options"
              :disabled="!subnets.enabled || busy"
              :loading="subnets.busy"
              :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledInput
              v-model:value="sshUser"
              :mode="mode"
              :disabled="busy"
              :required="true"
              label="SSH User ID"
          />
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped lang="scss">
.file-button {
  align-items: center;
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;

  > .file-selector {
    height: calc($input-height - 2px);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
}

.opentelekomcloud-config {
  display: flex;
  align-items: center;

  > .title {
    font-weight: bold;
    padding: 4px 0;
  }

  > .loading {
    margin-left: 20px;
    display: flex;
    align-items: center;

    > i {
      margin-right: 4px;;
    }
  }
}
</style>

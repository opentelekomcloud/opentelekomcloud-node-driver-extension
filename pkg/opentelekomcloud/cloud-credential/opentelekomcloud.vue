<script>
import Banner from '@components/Banner/Banner.vue';
import { LabeledInput } from '@components/Form/LabeledInput';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { parse as parseUrl } from '@shell/utils/url';
import { _CREATE } from '@shell/config/query-params';
import BusyButton from '../components/BusyButton.vue';
import { OpenTelekomCloud } from '../opentelekomcloud';

export default {
  components: {
    Banner,
    BusyButton,
    LabeledInput,
    LabeledSelect,
  },

  props: {
    mode: {
      type: String,
      required: true,
    },

    // Rancher Cloud Credential model
    value: {
      type: Object,
      required: true,
    },
  },

  async fetch() {
    // Load our node-driver so we can modify its whitelistDomains (same pattern as openstack.vue)
    this.driver = await this.$store.dispatch('rancher/find', {
      type: 'nodedriver',
      id:   'opentelekomcloud'
    });
  },

  data() {
    const decoded = this.value.decodedData || {};

    // When editing an existing Cloud Credential, hydrate decodedData from annotations
    if (this.mode !== _CREATE && this.value.annotations) {
      const ann = this.value.annotations;

      decoded.username          = ann['opentelekomcloud.cattle.io/username'] || decoded.username;
      decoded.domainName        = ann['opentelekomcloud.cattle.io/domainName'] || decoded.domainName;
      decoded.region            = ann['opentelekomcloud.cattle.io/region'] || decoded.region;
      decoded.authUrl           = ann['opentelekomcloud.cattle.io/authUrl'] || decoded.authUrl;
      decoded.projectName       = ann['opentelekomcloud.cattle.io/projectName'] || decoded.projectName;
    }

    // Default region if nothing is set yet
    if (!decoded.region) {
      decoded.region = 'eu-de';
    }

    // Ensure authUrl derived from region
    decoded.authUrl = this.authUrlForRegion(decoded.region);

    // Push back into the model via setData so the store sees the values
    this.value.setData('username', decoded.username || '');
    this.value.setData('domainName', decoded.domainName || '');
    this.value.setData('password', decoded.password || '');
    this.value.setData('region', decoded.region || '');
    this.value.setData('authUrl', decoded.authUrl || '');

    return {
      driver:         {},
      projects:       null,
      step:           1,
      busy:           false,
      errorAllowHost: false,
      allowBusy:      false,
      error:          '',
      region:         decoded.region || 'eu-de',
      project:        decoded.projectName || '',
    };
  },

  computed: {
    projectOptions() {
      const sorted = (this.projects || []).sort((a, b) => a.name.localeCompare(b.name));

      return sorted.map((p) => {
        return {
          label: p.name,
          value: p.name
        };
      });
    },

    // Static OTC regions – region is required
    regionOptions() {
      const regions = [
        { id: 'eu-de',  name: 'eu-de (Germany)' },
        { id: 'eu-nl',  name: 'eu-nl (Netherlands)' },
        { id: 'eu-ch2', name: 'eu-ch2 (Switzerland)' },
      ];

      return regions.map((r) => ({
        label: r.name,
        value: r.id
      }));
    },

    hostname() {
      const u = parseUrl(this.value.decodedData.authUrl);

      return u?.host || '';
    },

    // We can authenticate only when all required fields are present
    canAuthenticate() {
      return !!this.value?.decodedData?.domainName &&
        !!this.value?.decodedData?.username &&
        !!this.value?.decodedData?.password &&
        !!this.region &&
        !!this.value?.decodedData?.authUrl;
    },
  },

  watch: {
    region(newVal) {
      const url = this.authUrlForRegion(newVal);
      this.value.setData('region', newVal || '');
      this.value.setData('authUrl', url || '');
      this.value.decodedData.region = newVal;
      this.value.decodedData.authUrl = url;
    },
  },

  created() {
    this.$emit('validationChanged', false);

    this.value.annotations = this.value.annotations || {};

    if (!this.value.annotations['provisioning.cattle.io/driver']) {
      this.value.annotations['provisioning.cattle.io/driver'] = 'opentelekomcloud';
    }

    const url = this.authUrlForRegion(this.region);

    this.value.setData('region', this.region || '');
    this.value.setData('authUrl', url || '');
    this.value.decodedData.region = this.region;
    this.value.decodedData.authUrl = url;
  },

  methods: {
    // OTC-specific mapping from region -> IAM endpoint
    authUrlForRegion(region) {
      if (!region) {
        return '';
      }

      if (region === 'eu-ch2') {
        return `https://iam-pub.${ region }.sc.otc.t-systems.com/v3`;
      }

      return `https://iam.${ region }.otc.t-systems.com/v3`;
    },

    // Called by Rancher when validating before save
    test() {
      // Ensure annotations object exists
      this.value.annotations = this.value.annotations || {};

      const decoded = this.value.decodedData;

      this.value.annotations['opentelekomcloud.cattle.io/username']          = decoded.username;
      this.value.annotations['opentelekomcloud.cattle.io/domainName']        = decoded.domainName;
      this.value.annotations['opentelekomcloud.cattle.io/password']          = decoded.password;
      this.value.annotations['opentelekomcloud.cattle.io/region']            = decoded.region;
      this.value.annotations['opentelekomcloud.cattle.io/authUrl']           = decoded.authUrl;

      if (this.project) {
        const project = this.projects?.find((p) => p.name === this.project);

        if (project) {
          this.value.annotations['opentelekomcloud.cattle.io/projectName'] = project.name;
          // Also store projectName directly in the credential config so it is available on opentelekomcloudcredentialConfig
          this.value.setData('projectName', project.name || '');
          this.value.decodedData.projectName = project.name || '';
        }
      }

      return true;
    },

    // When user clicks “Edit Auth Config” – clear projects and go back to step 1
    clear() {
      this.step = 1;
      this.projects = null;
      this.errorAllowHost = false;

      // Tell parent that the form is now invalid again
      this.$emit('validationChanged', false);
    },

    hostInAllowList() {
      if (!this.driver?.whitelistDomains) {
        return false;
      }

      const u = parseUrl(this.value.decodedData.authUrl);

      if (!u.host) {
        return true;
      }

      return (this.driver?.whitelistDomains || []).includes(u.host);
    },

    async addHostToAllowList() {
      this.allowBusy = true;
      const u = parseUrl(this.value.decodedData.authUrl);

      this.driver.whitelistDomains = this.driver.whitelistDomains || [];

      if (!this.hostInAllowList()) {
        this.driver.whitelistDomains.push(u.host);
      }

      try {
        await this.driver.save();

        // Retry connect after whitelist update
        this.$refs.connect.$el.click();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Could not update driver', e);
        this.allowBusy = false;
      }
    },

    async connect(cb) {
      this.error = '';
      this.errorAllowHost = false;

      const decoded = this.value.decodedData;

      if (!decoded.authUrl) {
        return cb(false);
      }

      const os = new OpenTelekomCloud(this.$store, {
        endpoint:   decoded.authUrl,
        domainName: decoded.domainName,
        username:   decoded.username,
        password:   decoded.password,
      });

      this.allowBusy = false;
      this.step = 2;
      this.busy = true;

      let okay = false;

      const res = await os.getToken();

      if (res.error) {
        // eslint-disable-next-line no-console
        console.error(res.error);
        okay = false;

        this.step = 1;
        this.projects = null;

        if (res.error._status === 502 && !this.hostInAllowList()) {
          this.errorAllowHost = true;
        } else if (res.error._status === 502) {
          this.error = this.t?.('driver.opentelekomcloud.auth.errors.badGateway') || 'Bad gateway when talking to OTC IAM';
        } else if (res.error._status === 401) {
          this.error = this.t?.('driver.opentelekomcloud.auth.errors.unauthorized') || 'Unauthorized – check username/password/domain';
        } else {
          this.error = res.error.message || this.t?.('driver.opentelekomcloud.auth.errors.other') || 'Unexpected error when authenticating';
        }
      } else {
        const projects = await os.getProjects();

        if (!projects.error) {
          this.projects = projects;
          okay = true;
        } else {
          this.error = projects.error.message;
          okay = false;
        }
      }

      this.busy = false;

      // Pick first project by default if present
      this.project = this.projectOptions[0]?.value;

      // Region is selected separately and is required
      const valid = okay && !!this.region;

      this.$emit('validationChanged', valid);
      cb(valid);
    },

    onDomainNameInput(evt) {
      const v = evt && evt.target ? evt.target.value : evt;

      this.value.setData('domainName', v);
      this.value.decodedData.domainName = v;
    },

    onUsernameInput(evt) {
      const v = evt && evt.target ? evt.target.value : evt;

      this.value.setData('username', v);
      this.value.decodedData.username = v;
    },

    onPasswordInput(evt) {
      const v = evt && evt.target ? evt.target.value : evt;

      this.value.setData('password', v);
      this.value.decodedData.password = v;
    },

  }
};
</script>

<template>
  <div>
    <!-- Region + derived Auth URL -->
    <div class="row">
      <div class="col span-4">
        <LabeledSelect
            v-model:value="region"
            label-key="driver.opentelekomcloud.auth.fields.region"
            :options="regionOptions"
            :searchable="false"
        />
      </div>
      <div class="col span-8">
        <LabeledInput
          :value="value.decodedData.authUrl"
          :disabled="true"
          label-key="driver.opentelekomcloud.auth.fields.endpoint"
          placeholder-key="driver.opentelekomcloud.auth.placeholders.endpoint"
          type="text"
          :mode="mode"
        />
      </div>
    </div>

    <!-- Domain Name row full width -->
    <div class="row mt-20">
      <div class="col span-12">
        <LabeledInput
          :value="value.decodedData.domainName"
          label-key="driver.opentelekomcloud.auth.fields.domainName"
          placeholder-key="driver.opentelekomcloud.auth.placeholders.domainName"
          type="text"
          :mode="mode"
          @input="onDomainNameInput"
        />
      </div>
    </div>

    <!-- Username and Password row -->
    <div class="row mt-20">
      <div class="col span-6">
        <LabeledInput
          :value="value.decodedData.username"
          class="mt-20 md:mt-0"
          label-key="driver.opentelekomcloud.auth.fields.username"
          placeholder-key="driver.opentelekomcloud.auth.placeholders.username"
          type="text"
          :mode="mode"
          @input="onUsernameInput"
        />
      </div>
    </div>
    <div class="row mt-20">
      <div class="col span-6">
        <LabeledInput
            :value="value.decodedData.password"
            label-key="driver.opentelekomcloud.auth.fields.password"
            placeholder-key="driver.opentelekomcloud.auth.placeholders.password"
            type="password"
            :mode="mode"
            @input="onPasswordInput"
        />
      </div>
    </div>

    <!-- Authenticate button + edit -->
    <BusyButton
      ref="connect"
      label-key="driver.opentelekomcloud.auth.actions.authenticate"
      :disabled="step !== 1 || !canAuthenticate"
      class="mt-20"
      @click="connect"
    />

    <button
      class="btn role-primary mt-20 ml-20"
      :disabled="busy || step === 1"
      @click="clear"
    >
      {{ t('driver.opentelekomcloud.auth.actions.edit') }}
    </button>

    <!-- Error banners -->
    <Banner
      v-if="error"
      class="mt-20"
      color="error"
    >
      {{ error }}
    </Banner>

    <Banner
      v-if="errorAllowHost"
      color="error"
      class="allow-list-error"
    >
      <div>
        {{ t('driver.opentelekomcloud.auth.errors.notAllowed', { hostname }) }}
      </div>
      <button
        :disabled="allowBusy"
        class="btn ml-10 role-primary"
        @click="addHostToAllowList"
      >
        {{ t('driver.opentelekomcloud.auth.actions.addToAllowList') }}
      </button>
    </Banner>

    <!-- Project picker (optional but very useful for driver) -->
    <div
      v-if="projects"
      class="row mt-20"
    >
      <div class="col span-6">
        <LabeledSelect
            v-model:value="project"
            label-key="driver.opentelekomcloud.auth.fields.projectName"
            :options="projectOptions"
            :searchable="false"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .allow-list-error {
    display: flex;

    > :first-child {
      flex: 1;
    }
  }
</style>

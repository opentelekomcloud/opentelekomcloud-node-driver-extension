# OpenTelekomCloud Node Driver Extension for Rancher

This repository contains a **Rancher UI Extension** that integrates the **OpenTelekomCloud machine driver** into Rancher (RKE2).  
It provides a complete UI for configuring OTC machines, managing cloud credentials, and provisioning RKE2 clusters using OTC instances.

This extension replaces the legacy node-driver UI and implements Rancher's new **UI Extensions Framework** (v3+).

---

## Building and running locally

You can build and run the extensions locally, to do so:

- Run `yarn install`
- Set the `API` environment variable to point to a Rancher backend
- Run Rancher in development mode with `yarn dev`
- Open a web browser to `https://127.0.0.1:8005`

Once you log in, you should see Rancher load with the extensions automatically loaded. You can edit the code for the extensions
and then should hot-reload within the browser.

## Releasing an extension

Currently, releasing works through GitHub pages (need to create more secure way of releasing https://extensions.rancher.io/extensions/next/publishing) [[issue](https://github.com/opentelekomcloud/opentelekomcloud-node-driver-extension/issues/1)]
```bash
yarn publish-pkgs -s "opentelekomcloud/opentelekomcloud-node-driver-extension" -b "gh-pages"
```

Then Open `//rancher.instance/dashboard/c/_/uiplugins` -> `Manage Repositories` -> Create

### Bugs & Issues
Please submit bugs and issues to [opentelekomcloud/opentelekomcloud-node-driver-extension](https://github.com/opentelekomcloud/opentelekomcloud-node-driver-extension/issues).

Or just [click here](https://github.com/opentelekomcloud/opentelekomcloud-node-driver-extension/issues/new) to create a new issue.

License
=======
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
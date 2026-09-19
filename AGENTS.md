This repo is meant to be a bespoke sidecar for a home-lab papra installation.

The purpose of this app is to read email attachments and upload them to papra.

* To see the existing installation configuration, use the `gh` CLI to see the repo contents at https://github.com/rakeshpai/home-server-setup
* The papra API docs are located at https://docs.papra.app/resources/api-endpoints/

This repo consists of two packages.
1. One is a Cloudflare email worker that receives emails with attachments and posts it via a webhook to an internally running docker container.
2. The second is a TypeScript Node.js app packaged as a docker container that receives the email and its attachment via the webook POST, decrypts the attachment using the provided password via a config if necessary, parses the attachment using docling, and uploads the decrypted attachment with parsed content to papra. It also adds tags to the papra document based on config rules.
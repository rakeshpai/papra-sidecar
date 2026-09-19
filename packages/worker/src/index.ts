import PostalMime from 'postal-mime';
import { buildWebhookFormData } from './payload.js';
import { selectLargestPdf } from './select.js';

export interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

const worker: ExportedHandler<Env> = {
  async email(message, env) {
    if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) {
      throw new Error('Missing required configuration: WEBHOOK_URL and WEBHOOK_SECRET');
    }

    const parser = new PostalMime();
    const email = await parser.parse(message.raw);

    const attachment = selectLargestPdf(email.attachments);
    if (attachment === null) {
      console.log('No PDF attachment in email; dropping');
      return;
    }

    const form = buildWebhookFormData({
      email,
      attachment,
      observedFrom: message.from,
      observedTo: message.to,
    });

    const response = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WEBHOOK_SECRET}`,
      },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Webhook forwarding failed: ${response.status} ${await response.text()}`);
    }
  },
};

export default worker;
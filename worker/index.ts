import { Container, getContainer } from '@cloudflare/containers';

export class BackendContainer extends Container {
  defaultPort = 3000;
  sleepAfter = '5m';
}

interface Env {
  BACKEND: DurableObjectNamespace<BackendContainer>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.BACKEND, 'singleton');
    return container.fetch(request);
  },
};

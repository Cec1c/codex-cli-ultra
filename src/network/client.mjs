import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

export function createNetworkClient(settings, options = {}) {
  const fetchImpl = options.fetchImpl;
  if (fetchImpl) {
    return {
      fetch: fetchImpl,
      proxyEnabled: settings.network.proxyEnabled,
      proxyUrl: settings.network.proxyEnabled
        ? settings.network.proxyUrl
        : null,
      close: async () => {}
    };
  }
  const dispatcher = settings.network.proxyEnabled
    ? new ProxyAgent(settings.network.proxyUrl)
    : new Agent();
  return {
    fetch: (url, init = {}) => undiciFetch(url, { ...init, dispatcher }),
    proxyEnabled: settings.network.proxyEnabled,
    proxyUrl: settings.network.proxyEnabled
      ? settings.network.proxyUrl
      : null,
    close: async () => {
      await dispatcher.close();
    }
  };
}

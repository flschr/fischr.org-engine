(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWGithubService = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function isTransientStatus(status) {
    return status === 429 || status >= 500;
  }

  function isTransientError(error) {
    const message = String(error?.message || error || "");
    return /^GitHub (429|5\d\d)\b/.test(message) || /Failed to fetch|NetworkError/i.test(message);
  }

  function createClient({ repository, getAccess, wait = defaultWait, fetchImpl = fetch }) {
    return async function github(endpoint, options = {}) {
      const access = getAccess();
      const method = options.method || "GET";
      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      };
      if (!access.proxy && access.token) headers.Authorization = `Bearer ${access.token}`;

      const init = { method, headers };
      if (options.signal) init.signal = options.signal;
      if (access.proxy) init.credentials = "same-origin";
      if (options.body) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }

      const url = access.proxy
        ? `/api/github/${endpoint}`
        : `https://api.github.com/repos/${repository.owner}/${repository.name}/${endpoint}`;
      let response;
      const attempts = method === "GET" ? 4 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        response = await fetchImpl(url, init);
        if (response.ok || !isTransientStatus(response.status) || attempt === attempts - 1) break;
        await wait(1000 * (2 ** attempt));
      }
      if (!response.ok) throw new Error(await responseError(response));
      if (response.status === 204) return null;
      return response.json();
    };
  }

  async function responseError(response) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload.message ? `: ${payload.message}` : "";
    } catch {
      detail = "";
    }
    return `GitHub ${response.status}${detail}`;
  }

  function defaultWait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  return { createClient, isTransientError, isTransientStatus };
});

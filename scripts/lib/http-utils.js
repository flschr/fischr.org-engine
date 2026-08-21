class HttpResponseError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
  }
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const duration = Number(timeoutMs);
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error(`timeoutMs must be a positive integer; received ${JSON.stringify(timeoutMs)}.`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), duration);

  try {
    return await fetchImpl(url, {
      ...fetchOptions,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isPermanentClientError(error) {
  return (
    error instanceof HttpResponseError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 425, 429].includes(error.status)
  );
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

module.exports = {
  fetchWithTimeout,
  HttpResponseError,
  isPermanentClientError,
  responseText
};

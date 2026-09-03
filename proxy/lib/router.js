/**
 * Routing. Exact segment matching with named parameters, each constrained by its
 * own pattern at registration rather than validated after the fact -- a request
 * whose parameter cannot be safe never reaches a handler.
 */

const DEFAULT_PARAM = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Binds one route's segments against a split pathname.
 * @returns {object|null} the parameters, or null when this route does not match.
 */
function bind(route, parts) {
  if (route.segments.length !== parts.length) return null;

  const params = {};
  for (let i = 0; i < parts.length; i++) {
    const segment = route.segments[i];
    if (!segment.param) {
      if (segment.name !== parts[i]) return null;
      continue;
    }
    // A malformed escape such as %zz throws here. That is a request matching no
    // route, not a proxy fault, so it is a miss rather than an error.
    let value;
    try {
      value = decodeURIComponent(parts[i]);
    } catch {
      return null;
    }
    if (!(route.params[segment.name] || DEFAULT_PARAM).test(value)) return null;
    params[segment.name] = value;
  }
  return params;
}

export function createRouter() {
  const routes = [];

  const add = (method, pattern, handler, options = {}) => {
    const segments = pattern.split("/").filter(Boolean).map(segment =>
      segment.startsWith(":")
        ? { name: segment.slice(1), param: true }
        : { name: segment, param: false }
    );
    routes.push({
      method,
      pattern,
      segments,
      handler,
      scope: options.scope || null,
      params: options.params || {},
      // Public routes skip session verification. Only /healthz and /session are.
      auth: options.auth !== false
    });
    return api;
  };

  const api = {
    get: (pattern, handler, options) => add("GET", pattern, handler, options),
    post: (pattern, handler, options) => add("POST", pattern, handler, options),

    /** @returns {{route:object, params:object}|null|"method"} "method" = path known, verb wrong. */
    match(method, pathname) {
      const parts = pathname.split("/").filter(Boolean);
      let pathMatched = false;

      for (const route of routes) {
        const params = bind(route, parts);
        if (params === null) continue;

        pathMatched = true;
        if (route.method === method) return { route, params };
      }

      return pathMatched ? "method" : null;
    },

    /** The verbs this path does accept, so a 405 can name them accurately. */
    allowed(pathname) {
      const parts = pathname.split("/").filter(Boolean);
      const methods = [];
      for (const route of routes) {
        if (bind(route, parts) !== null && !methods.includes(route.method)) {
          methods.push(route.method);
        }
      }
      return methods;
    },

    get routes() {
      return routes.map(({ method, pattern, scope, auth }) => ({ method, pattern, scope, auth }));
    }
  };

  return api;
}

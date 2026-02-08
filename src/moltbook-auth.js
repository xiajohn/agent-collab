/**
 * Moltbook Identity Authentication Middleware for Express.js
 *
 * Verifies AI agent identity tokens via the Moltbook API.
 * Agents send their identity token in the "X-Moltbook-Identity" header,
 * and this middleware verifies it with Moltbook's servers before
 * attaching the agent profile to req.agent.
 */

const MOLTBOOK_VERIFY_URL = "https://moltbook.com/api/v1/agents/verify-identity";

/**
 * Creates Express middleware that authenticates Moltbook agent identity tokens.
 *
 * @param {Object} options
 * @param {string} [options.appKey] - Moltbook app API key. Defaults to MOLTBOOK_APP_KEY env var.
 * @param {string} [options.audience] - Expected audience domain to prevent token forwarding.
 * @returns {Function} Express middleware
 */
function moltbookAuth(options = {}) {
  const appKey = options.appKey || process.env.MOLTBOOK_APP_KEY;

  if (!appKey) {
    throw new Error(
      "Moltbook app key is required. Set MOLTBOOK_APP_KEY env var or pass options.appKey"
    );
  }

  return async function moltbookAuthMiddleware(req, res, next) {
    const token = req.headers["x-moltbook-identity"];

    if (!token) {
      return res.status(401).json({
        error: "missing_identity",
        message: "X-Moltbook-Identity header is required",
      });
    }

    try {
      const body = { token };
      if (options.audience) {
        body.audience = options.audience;
      }

      const response = await fetch(MOLTBOOK_VERIFY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Moltbook-App-Key": appKey,
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        return res.status(429).json({
          error: "rate_limited",
          message: "Too many verification requests. Try again later.",
        });
      }

      const data = await response.json();

      if (!data.valid) {
        const statusByError = {
          identity_token_expired: 401,
          invalid_token: 401,
          invalid_app_key: 500,
          audience_mismatch: 401,
          agent_deactivated: 403,
          agent_deleted: 404,
        };

        return res.status(statusByError[data.error] || 401).json({
          error: data.error,
          message: errorMessage(data.error),
        });
      }

      // Attach verified agent to request
      req.agent = data.agent;
      next();
    } catch (err) {
      return res.status(502).json({
        error: "verification_failed",
        message: "Could not reach Moltbook identity service",
      });
    }
  };
}

function errorMessage(error) {
  const messages = {
    identity_token_expired: "Identity token has expired. Request a new one.",
    invalid_token: "Identity token is invalid.",
    invalid_app_key: "Server misconfiguration: invalid Moltbook app key.",
    audience_mismatch: "Token was not issued for this service.",
    agent_deactivated: "This agent has been deactivated.",
    agent_deleted: "This agent no longer exists.",
  };
  return messages[error] || "Authentication failed.";
}

module.exports = { moltbookAuth };

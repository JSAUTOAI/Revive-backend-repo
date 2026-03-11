/**
 * Admin Authentication Middleware
 *
 * Protects admin routes with bearer token authentication.
 * Token must be passed in Authorization header: "Bearer <token>"
 */

function requireAdminAuth(req, res, next) {
  // Get token from Authorization header or query parameter (for new-tab endpoints like tax-report)
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;

  if (!authHeader && !queryToken) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - No authorization header provided'
    });
  }

  // Extract token (format: "Bearer <token>" or ?token=xxx)
  const token = queryToken || authHeader.replace('Bearer ', '');

  // Compare with environment variable
  const validToken = process.env.ADMIN_TOKEN;

  if (!validToken) {
    console.error('[Auth] ADMIN_TOKEN not set in environment variables');
    return res.status(500).json({
      success: false,
      error: 'Server configuration error'
    });
  }

  if (token !== validToken) {
    console.warn('[Auth] Invalid token attempt');
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid token'
    });
  }

  // Token is valid, proceed to route
  console.log('[Auth] Admin access granted');
  next();
}

module.exports = { requireAdminAuth };

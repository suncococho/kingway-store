const { logWorkflowEvent } = require("../services/lineWorkflowService");

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  logWorkflowEvent("system_error", "HTTP", null, {
    method: req.method,
    path: req.originalUrl,
    statusCode: error.statusCode || 500,
    message: error.message || "Internal server error"
  }).catch(() => {});

  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    message: error.message || "Internal server error"
  });
}

module.exports = {
  errorHandler
};

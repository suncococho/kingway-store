"use strict";

const {
  READ_ONLY_VALIDATION_MODE,
  WRITE_BLOCK_CODE,
  isAllowedValidationHttpMethod,
  isReadOnlyValidationMode
} = require("../runtime/validationMode");

function readOnlyValidationMiddleware(req, res, next) {
  if (!isReadOnlyValidationMode() || isAllowedValidationHttpMethod(req.method)) {
    return next();
  }

  return res.status(503).json({
    ok: false,
    code: WRITE_BLOCK_CODE,
    message: "Backend validation mode permits read-only HTTP requests only.",
    validationMode: READ_ONLY_VALIDATION_MODE
  });
}

module.exports = { readOnlyValidationMiddleware };

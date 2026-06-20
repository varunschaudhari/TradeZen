/**
 * @file validateRequest.js
 * @description Joi request validation middleware factory
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

/**
 * Creates a middleware that validates req.body against a Joi schema
 * @param {import('joi').ObjectSchema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 */
export const validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });

  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details.map((d) => d.message).join(', '),
      code: 400,
    });
  }

  req.body = value;
  next();
};

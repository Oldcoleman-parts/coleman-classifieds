// Public API of the core module. Other modules import only from here.
// Shared shapes are in ./types.js (JSDoc only). The lifecycle, event bus, flags and
// settings are added in F01-T2.
export {
  AppError,
  ConflictError,
  NotFoundError,
  ShopifyUserError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";
export {
  optionalString,
  readForm,
  requireCents,
  requireEmail,
  requireEnum,
  requireId,
  requireInt,
  requireString,
} from "./validators.js";

/** Called from the app bootstrap. Core has no event listeners yet. */
export function register() {}

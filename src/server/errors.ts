export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (msg = "Please sign in to continue.") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have permission to do this.") => new AppError(403, "FORBIDDEN", msg);
/** Use for anything the caller may not see — never reveal whether it exists. */
export const notFound = (msg = "Not found.") => new AppError(404, "NOT_FOUND", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);

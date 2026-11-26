const hasConstraintViolation = (
  error: unknown,
  sqlState: string,
  constraintName: string,
): boolean => {
  for (
    let current: unknown = error, depth = 0;
    typeof current === "object" && current !== null && depth < 3;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, constraint } = current as {
      code?: unknown;
      constraint?: unknown;
    };
    if (code === sqlState && constraint === constraintName) return true;
  }
  return false;
};

export const isForeignKeyViolation = (
  error: unknown,
  constraintName: string,
): boolean => hasConstraintViolation(error, "23503", constraintName);

export const isUniqueViolation = (
  error: unknown,
  constraintName: string,
): boolean => hasConstraintViolation(error, "23505", constraintName);

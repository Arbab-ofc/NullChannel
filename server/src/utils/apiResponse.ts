export const successResponse = <T>(data: T) => ({ success: true, data, error: null });

export const errorResponse = (code: string, message: string) => ({
  success: false,
  data: null,
  error: { code, message }
});

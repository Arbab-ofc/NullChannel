export const logger = {
  info: (operation: string, details: Record<string, unknown> = {}) => console.info(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'info', operation, ...details })),
  error: (operation: string, details: Record<string, unknown> = {}) => console.error(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'error', operation, ...details }))
};

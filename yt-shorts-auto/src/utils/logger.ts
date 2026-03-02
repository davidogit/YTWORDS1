import pino from 'pino';

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
  level: process.env.LOG_LEVEL ?? 'info',
});

/** Create a child logger scoped to a module */
export function moduleLogger(module: string) {
  return logger.child({ module });
}

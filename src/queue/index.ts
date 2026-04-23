import PQueue from 'p-queue';
import { env } from '../config/env.ts';

export const queue = new PQueue({ concurrency: env.QUEUE_CONCURRENCY });

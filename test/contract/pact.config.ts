import { resolve } from 'node:path';

export const CONSUMER = 'marketplace-web';
export const PROVIDER = 'marketplace-api';
export const PACT_DIR = resolve(__dirname, '../../pacts');
export const PACT_FILE = resolve(PACT_DIR, `${CONSUMER}-${PROVIDER}.json`);

export const ORDER_ID = 9001;
export const PRODUCT_ID = 9001;

export const STATE_ORDER_EXISTS = `order ${ORDER_ID} exists`;
export const STATE_PRODUCT_EXISTS = `product ${PRODUCT_ID} exists`;

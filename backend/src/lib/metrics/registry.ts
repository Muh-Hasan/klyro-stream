import { collectDefaultMetrics, Registry } from 'prom-client';
import { type ServiceName, setServiceName } from '../../utils/logger.js';

export const registry = new Registry();

export const initObservability = (service: ServiceName) => {
  setServiceName(service);
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
};

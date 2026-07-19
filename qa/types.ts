import { z } from 'zod';
import type { RetrievalCriteria } from '@/catalog/types';

export const probeSchema = z.object({
  id: z.string(),
  attack: z.string(),
  turns: z.string().array().min(1),
});

export const probeFileSchema = z.object({
  probes: probeSchema.array().min(1),
});

export type Probe = z.infer<typeof probeSchema>;

export type ProbeProductRecord = {
  id: number;
  title: string;
  price: number;
  effectivePrice: number;
  discountPercentage: number;
  rating: number;
  category: string;
  minimumOrderQuantity: number;
  minimumSpend: number;
};

export type ProbeTurnRecord = {
  probeId: string;
  message: string;
  text: string;
  failure?: string;
  toolCallCount: number;
  criteriaPerCall: RetrievalCriteria[];
  products: ProbeProductRecord[];
  flags: string[];
};

export type ProbeReport = {
  id: string;
  attack: string;
  turns: ProbeTurnRecord[];
};

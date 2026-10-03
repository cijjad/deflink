import { z } from "zod";
import { readJson, route } from "@/server/http";
import { resolveOwner } from "@/server/owner";
import { patchRequirement } from "@/server/services/conversation";

const schema = z.object({
  destination: z.string().max(120).optional(),
  condition: z.enum(["NEW", "NEW_OR_APPROVED_ALTERNATIVE", "ANY", "NEW_SURPLUS", "OVERHAULED", "SERVICEABLE", "REPAIRED", "AS_REMOVED"]).optional(),
  requiredBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  certification: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        key: z.string().max(40).optional(),
        partNumber: z.string().max(60).nullable().optional(),
        description: z.string().max(300).nullable().optional(),
        quantity: z.number().positive().max(1e9).nullable().optional(),
        unit: z.string().max(6).optional(),
        remove: z.boolean().optional(),
      }),
    )
    .max(500)
    .optional(),
});

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, schema);
  const { owner } = await resolveOwner(false);
  return patchRequirement(id, owner, body);
});

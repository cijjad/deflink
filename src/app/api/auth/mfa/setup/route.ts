import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { beginMfaSetup } from "@/server/services/auth";

export const POST = route(async () => beginMfaSetup(await requireUser()));

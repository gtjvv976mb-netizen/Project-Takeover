import { appConfig } from "@/lib/solana";
import { json } from "@/lib/api-utils";
export const dynamic = "force-dynamic";
export async function GET() { return json(appConfig()); }

import { chainConfig } from "@/lib/solana";
import { json } from "@/lib/api-utils";
export const dynamic = "force-dynamic";
/** Reads the fee and treasury from the program, so the browser can never build a
 *  transaction against a treasury the program will reject. */
export async function GET() { return json(await chainConfig()); }

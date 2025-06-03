// @/lib/schema/solanaTokenMarketData.ts
import { z } from 'zod';

export const solanaTokenMarketDataSchema = z.object({
  tokenSymbol: z.string().optional().describe("The ticker symbol of the Solana token (e.g., '$NOS', 'USDC')."),
  tokenMintAddress: z.string().optional().describe("The SPL token mint address (e.g., 'nosSoPRIVATE...'). Either symbol or mint address should be provided.")
}).refine(data => data.tokenSymbol || data.tokenMintAddress, {
  message: "Either tokenSymbol or tokenMintAddress must be provided.",
});

export type SolanaTokenMarketDataParams = z.infer<typeof solanaTokenMarketDataSchema>;
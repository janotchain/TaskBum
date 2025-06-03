import { SearchResultImage, SearchResults } from '@/lib/types'
import { sanitizeUrl } from '@/lib/utils'
import { BaseSearchProvider } from './base'

export class TavilySearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = 10,
    searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [
      'solana.com',          // Official Solana
  'solscan.io',          // Explorer
  'solana.fm',           // Explorer
  'explorer.solana.com', // Explorer
  'defillama.com',       // DeFi Stats (often has Solana sections)
  'coingecko.com',       // Token info
  'coinmarketcap.com',   // Token info
  'solanafloor.com',     // Solana News
  'decrypt.co',          // News (often covers Solana, can be refined with path if Tavily supports)
  'theblockcrypto.com',  // News
  'nosana.io',           // Example Project
  'jup.ag',              // Example Project (Jupiter)
  'tensor.trade',        // Example Project (Tensor)
  'drift.trade',         // Example Project (Drift)
  'pyth.network',        // Example Project (Pyth)
  'magiceden.io',        // NFT Marketplace
  'metaplex.com',        // NFT Standard
  'docs.solana.com',     // Solana Documentation
  'github.com/solana-labs', // Official GitHub (for some types of queries)
  'medium.com',          // Blogs (can be project-specific, good for news)
  'substack.com',        // Newsletters
    ],
    excludeDomains: string[] = []
  ): Promise<SearchResults> {
    const apiKey = process.env.TAVILY_API_KEY
    this.validateApiKey(apiKey, 'TAVILY')

    // Tavily API requires a minimum of 5 characters in the query
    const filledQuery =
      query.length < 5 ? query + ' '.repeat(5 - query.length) : query

    const includeImageDescriptions = true
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: filledQuery,
        max_results: Math.max(maxResults, 5),
        search_depth: searchDepth,
        include_images: true,
        include_image_descriptions: includeImageDescriptions,
        include_answers: true,
        include_domains: includeDomains,
        exclude_domains: excludeDomains
      })
    })

    if (!response.ok) {
      throw new Error(
        `Tavily API error: ${response.status} ${response.statusText}`
      )
    }

    const data = await response.json()
    const processedImages = includeImageDescriptions
      ? data.images
          .map(({ url, description }: { url: string; description: string }) => ({
            url: sanitizeUrl(url),
            description
          }))
          .filter(
            (
              image: SearchResultImage
            ): image is { url: string; description: string } =>
              typeof image === 'object' &&
              image.description !== undefined &&
              image.description !== ''
          )
      : data.images.map((url: string) => sanitizeUrl(url))

    return {
      ...data,
      images: processedImages
    }
  }
}
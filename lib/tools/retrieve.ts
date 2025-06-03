import { retrieveSchema } from '@/lib/schema/retrieve'; // Zod schema for parameters (likely just a 'url' string)
import { SearchResults as SearchResultsType } from '@/lib/types'; // Your custom type for search/retrieval results
import { tool } from 'ai'

const CONTENT_CHARACTER_LIMIT = 10000

// Fetches and processes content from a URL using Jina Reader API
async function fetchJinaReaderData(
  url: string
): Promise<SearchResultsType | null> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, { // Jina's reader endpoint
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-With-Generated-Alt': 'true' // Jina-specific header
      }
    })
    const json = await response.json()
    if (!json.data || json.data.length === 0) { // Check for valid data
      return null
    }

    const content = json.data.content.slice(0, CONTENT_CHARACTER_LIMIT) // Truncate content

    // Formats the Jina response into your SearchResultsType
    return {
      results: [
        {
          title: json.data.title,
          content,
          url: json.data.url
        }
      ],
      query: '', // No query for retrieval
      images: [] // No images from retrieval
    }
  } catch (error) {
    console.error('Jina Reader API error:', error)
    return null
  }
}

// Fetches and processes content from a URL using Tavily Extract API
async function fetchTavilyExtractData(
  url: string
): Promise<SearchResultsType | null> {
  try {
    const apiKey = process.env.TAVILY_API_KEY
    const response = await fetch('https://api.tavily.com/extract', { // Tavily's extract endpoint
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ api_key: apiKey, urls: [url] }) // Send URL to extract
    })
    const json = await response.json()
    if (!json.results || json.results.length === 0) { // Check for valid results
      return null
    }

    const result = json.results[0] // Assuming one URL, so one result
    const content = result.raw_content.slice(0, CONTENT_CHARACTER_LIMIT) // Truncate raw content

    // Formats the Tavily extract response into your SearchResultsType
    return {
      results: [
        {
          title: content.slice(0, 100), // Uses first 100 chars of content as title (could be improved if Tavily provides a title)
          content,
          url: result.url
        }
      ],
      query: '', // No query
      images: []   // No images
    }
  } catch (error) {
    console.error('Tavily Extract API error:', error)
    return null
  }
}

// Defines the retrieveTool using Vercel AI SDK's `tool` helper
export const retrieveTool = tool({
  description: 'Retrieve content from the web for a specific URL.', // Description for the LLM
  parameters: retrieveSchema, // Zod schema (e.g., z.object({ url: z.string().url() }))
  execute: async ({ url }) => { // The function the LLM calls
    let results: SearchResultsType | null

    // Conditional logic: Use Jina if JINA_API_KEY is set, otherwise Tavily
    const useJina = process.env.JINA_API_KEY
    if (useJina) {
      results = await fetchJinaReaderData(url)
    } else {
      results = await fetchTavilyExtractData(url)
    }

    if (!results) { // If both failed or returned no content
      return { error: "Failed to retrieve content from the URL or no content found." };
      // Or return null, depending on how your LLM handles null tool results.
      // Returning an error object is often better.
    }

    return results // Return the formatted content
  }
})
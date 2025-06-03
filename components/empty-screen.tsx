import { Button } from '@/components/ui/button'; // Assuming you use shadcn/ui
import { ArrowRight } from 'lucide-react'

// Updated example messages for the Solana Ecosystem Researcher
const exampleMessages = [
  {
    heading: 'What is Nosana ($NOS)?',
    message: 'Tell me about the Nosana ($NOS) project and its role in the Solana ecosystem.'
  },
  {
    heading: 'Explain Jupiter Aggregator ($JUP)',
    message: 'What is Jupiter Exchange ($JUP) on Solana and how does it work?'
  },
  {
    heading: 'Tokenomics of Pyth Network ($PYTH)',
    message: 'What are the tokenomics of the Pyth Network ($PYTH)?'
  },
  {
    heading: 'Solana Compressed NFTs (cNFTs)',
    message: 'Explain Solana Compressed NFTs (cNFTs) and their benefits.'
  },
  {
    heading: 'Latest news on Firedancer',
    message: 'What is the latest news or developments regarding Firedancer for Solana?'
  },
  {
    heading: 'Compare SOL Staking: Jito vs Marinade',
    message: 'Compare Jito SOL versus Marinade mSOL for liquid staking on Solana.'
  },
  {
    heading: 'What is the Helium (HNT) migration?',
    message: 'Can you provide details on the Helium (HNT) network migration to Solana?'
  },
  {
    heading: 'Summary: Solana Validator Health Report', // Replace with a real, relevant URL
    message: 'Summary: https://solana.org/validator-health-report' // Example URL
  }
]

export function EmptyScreen({
  submitMessage,
  className
}: {
  submitMessage: (message: string) => void
  className?: string
}) {
  return (
    <div className={`mx-auto w-full transition-all ${className}`}>
      <div className="bg-background p-2">
        <div className="mt-4 flex flex-col items-start space-y-2 mb-4"> {/* Added mt-4 for a bit more top margin */}
          <h2 className="text-lg font-semibold mb-3 px-1 text-foreground"> {/* Optional: Title for examples */}
            Example Solana Questions:
          </h2>
          {exampleMessages.map((message, index) => (
            <Button
              key={index}
              variant="link"
              className="h-auto p-1 text-base text-left hover:no-underline text-blue-600 dark:text-blue-400" // Styling for better link appearance
              name={message.message} // The 'name' attribute is fine, but not standard for semantic meaning on buttons
              title={`Ask about: ${message.heading}`} // Added title for accessibility/tooltip
              onClick={async () => {
                submitMessage(message.message)
              }}
            >
              <ArrowRight size={16} className="mr-2 text-muted-foreground flex-shrink-0" /> {/* Added flex-shrink-0 */}
              <span className="truncate">{message.heading}</span> {/* Added truncate in case headings are long */}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
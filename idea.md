
The Challenge
Build a product that solves a real need for founders or investors, powered by reliable public data from Cala.

Introduction: Founders and investors make some of their most important decisions based on scattered information: dozens of browser tabs, outdated databases and gut feeling. AI agents could change that, but when they go to the web for answers, they find information that is messy, stale and disconnected. Cala gives agents a structured, reliable way to query the world's public information, from companies and people to funding rounds and investors. Now it's your turn to put it to work for the startup ecosystem, and help make the next unicorns real.

The challenge: Build a product on top of Cala's data that solves a real need for founders, investors, or both. It can be a focused tool for a specific user, like a first-time founder raising their very first round or a small fund deciding which industries to bet on next, or a broader tool for the whole ecosystem, like an agent that connects the right founders and investors. Don't try to cover everything: one need solved in an original, well-executed way beats a platform that does ten things halfway. You have a weekend, and Slush, Europe's main meeting point for founders and investors, starts right after: aim for a complete product they could start using the day after the hackathon. Make it rely on what makes Cala different: structured, sourced data on companies, funding rounds and investors, and the connections between them.

How we judge: We reward sharp ideas, done well: a fresh angle on a real need scores higher than a generic version of an idea we've seen many times. Focus beats breadth: one need solved brilliantly wins over many solved halfway. • Real need (25%): a clear user with a problem worth solving • Execution (25%): it works smoothly, end to end • Originality (25%): a fresh angle, even on a familiar problem • Use of Cala (25%): Cala is core to the product, not an add-on

Prizes: Each member of the winning team becomes a Cala Comet, a prize worth around €5,000 for a team of four. For three months, each member will get to attend one hackathon of their choice per month, with travel and accommodation covered by Cala. The winning team also gets €1,000 in Cala credits and Cala merch, and the runner-up team receives €500 in Cala credits and Cala merch.

About Cala: The world is increasingly run by agents, but when they need reliable external data, they go to the web and find information that is often hard to trust, out of date and scattered across sources. Cala is the public data layer for AI agents: an agent-first database of the world, built on a knowledge graph where every data point is sourced and connected, and queryable through an API or MCP. Enterprise clients already use Cala in agentic workflows across finance, pharma and legal. We're at Junction to see what builders create when reliable data is no longer the bottleneck.

Insight
Some needs we hear often, as starting points rather than a menu:

• Raising money smarter: helping founders find the investors who actually take the lead in funding companies like theirs, and who are still actively investing today.

• Reading a market: seeing who's competing, who just raised money and from whom, and how much funding is flowing into an industry.

• Investing with confidence: spotting promising young companies before anyone else does, or getting a quick, well-sourced background check on a company before putting money in.

• Beyond funding: finding first customers among companies that just raised, sizing a market with real company data, or mapping who might buy a startup one day.

We'd love to see needs we haven't thought of.


===========================

CalaViz - a data visualisation tool for both investors and analysts, built on top Cala's trustbale knowledge base.  (and we also bringing some findings insights based on the graph).
CalaViz helps users to explore Cala data, build interactive reports (low code), and share the report template for others!

Template reports can be built by professionals (analysts) and can be re-used by investor, that means, report can be used in different parameters

Reusable templates examples:
https://harmless-tidy-redbird.eur-1.aiven.app/#/r/next-check  [try to change sector from 'artificial intelligence' to  'blockchain' to see how the investor are so bullish on AI]
https://harmless-tidy-redbird.eur-1.aiven.app/#/r/investor-graph?investor=Sequoia+Capital&sector=blockchain+&since=2020 [try to change sector from 'blockchain' to 'artificial intelligence' to see changes]
https://harmless-tidy-redbird.eur-1.aiven.app/#/r/investor-graph [this shows graph transformation]
We will send you more ...

The story behind: I tried to find and submit 5 insights I found from the knowledge graph that valuable to investors. But I thought, why don't I build a tools for folks to create insights, stories and share that to others 

Pros:
It's address both Cala's useful tools upon Cala data and also give data insights for Cala
It's versatile (data exfloration, interactive reports, autocomplete, autosuggestion, AI report creator) and still keep Cala's value: trust



what I love is the data exploration


CalaViz is a low-code data workspace built on Cala's knowledge graph. Analysts explore the data with autosuggest and build interactive reports from cells: charts, investor networks, drill-down, fact checks and AI-written notes. Cala AI can also build a whole report for you. Each report is saved as a reusable template, so investors can change the sector or investor and get a fresh, sourced answer.

Reusable template examples:
- Where should our next check go? (https://harmless-tidy-redbird.eur-1.aiven.app/#/r/next-check): change sector from artificial intelligence to blockchain and the biggest early round drops from $2B to $47M.
- Investor graph network (https://harmless-tidy-redbird.eur-1.aiven.app/#/r/investor-graph?investor=Sequoia+Capital&sector=blockchain+&since=2020): Sequoia Capital's co-investor network for any sector. Switch blockchain to artificial intelligence and the network changes.


The challenge invited us to explore Cala's data, so we started by digging through the knowledge graph to find five insights worth handing to investors, like where the next check should go or who really leads the rounds in a sector. Each insight took a query, a few transformations, a chart and a written story. Then we noticed that changing the sector or the investor meant starting over.

So we stopped asking "what are the five best insights?" and asked "why not let everyone find their own?" CalaViz is the result. The five insights we were hunting for became templates. Analysts can build new ones, and investors can re-run any of them with their own values and share what they find, with every number still sourced from Cala.

- Explore with autosuggest: the query box suggests Cala fields as you type (industry, founded_year, investors…) and real values seen in Cala (Fintech, Sequoia Capital…).
- Input parameters: write {{sector}} or {{investor}} in a query and it becomes an input field, so analysts build a report once with or without hardcoded values.
- Low-code cells: chain cells to build a report, with each cell working on the one before:
  - Data: query, join
  - Transform: filter, sort, split, aggregate
  - Visualize: bar and line charts, company ↔ investor network graphs
  - Explain: notes, fact checks, AI notes
- Reusable templates: investors open a report, type their own values and get a fresh, sourced answer. They can share it as a link with the values in it.
- AI report maker: ask Cala AI to build a report from a query. It plans the sections, runs Cala queries, adds cells and charts, checks its work and writes the story, in under a minute.
- AI notes: a note that reads the cells above it and writes the insight, then rewrites itself when the data changes.
- Interactive drill-down: click a bar to see the rows behind it, or Shift-/⌘-click to select several. Every chart and table below filters to match.
- Fact checks: compare a claimed number or name with Cala's sources and get "✓ Matches sources", "Differs from sources" or "Not in sources".
- Trust built in: every number comes from Cala, and the report flags written notes that no longer match the values on screen.
- Premade reports: next-check comparisons, investor networks, co-investor background checks, M&A playbooks, AI-lab alumni and funding pulses.

Our personal favorite is the data exploration. I start typing a query and CalaViz suggests Cala's fields, then the real values it has seen in Cala: industries, investors, companies. One query leads to a question I hadn't planned to ask, and before I know it I'm three cells deep in a network of who backs whom. It turns a database into something you can wander through, and every step stays sourced.
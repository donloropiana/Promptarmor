**The short version**

The idea is right, but the design has grown too big. It has about 18 screens, 10 statuses and 5 different ways to reach the AI. Cut it to four places: an Ads list, an ad page, Rules and Settings. Don't put chat everywhere. Put one "Ask about this ad" box on the ad page, and make sure it can only answer, never act.

**What to change**

*Simpler*
- **One Ads list replaces the Dashboard, Queue and Reports.** It is sorted worst first, with four tabs (Needs review, Changes requested, Approved, All) and one line of real numbers on top. Inspired by Stripe Radar, whose review queue is one prioritized list.
- **Four statuses: Needs review, Changes requested, Approved, Rejected.** Each row gets a small tag that says why it is there: New, V2, Rates changed or Hidden text. Fewer words to learn. Inspired by Linear, which has few statuses and uses tags for the rest.
- **No Intake or Triage page.** Exact duplicates merge on their own. Non-ads are skipped behind a "14 skipped · show" line. When the app isn't sure, it asks "Is this an ad? Yes / No" right in the list. Inspired by Linear's automatic triage.
- **Rules has two tabs: Rules and Products.** Starter rules are already switched on, and each rule links to its legal source. Inspired by Ramp's policy page.

*Faster*
- **An empty home is one drop box plus 3 sample ads,** one of them with hidden text aimed at the AI. You see your first checked ad in under a minute, with no setup forms first. Inspired by ChatGPT's instant start and Apple's advice to put setup off until it's needed.
- **Each issue has one action: "Not a problem", with a reason.** Every other issue goes on the fix list. If you approve while issues are still open, the app asks for one written reason per issue. That is the exception, decided once. After each decision the next ad opens, and the keys are J/K to move, X, R and A. Inspired by GitHub reviews and Gmail auto-advance.
- **Version 2 opens on the same ad page.** It shows what changed and marks each old issue Fixed, Still there or New. The button reads "Approve V2". Inspired by Vercel, which promotes one exact deployment.

*Clearer*
- **One word per thing:** ad (not asset), workspace (not profile), issue (not finding), check (not preflight). Change the on-screen text only and leave the code names alone. Inspired by Apple's UX writing talk at WWDC25.
- **Each list row shows a small thumbnail, the ad's headline, the problem words in quotes, and a red count.** Don't use a Pinterest-style grid, because it breaks the worst-first order.
- **Be honest before connecting Google or Microsoft.** The card says: "Reads only. Looks back 14 days. Keeps only ads. Google will list wider permissions than we use, and our code blocks those." Inspired by Ramp's mailbox integration.

*More powerful*
- **When a rate changes in Products, approved ads that quote the old rate go back to Needs review,** tagged "Rates changed". This is PromptArmor's own "monitor changes" pitch.
- **Hidden-text alerts are the demo's big moment.** Show the hidden instruction, show that the real issues were still flagged, and show that the AI has no way to approve anything.

**Chat everywhere?**

No. A chat box on every page gives every button a second, slower twin. Each box is also one more place where hidden text in an ad can try to steer the AI. A box that answers questions across everyone's mail is exactly the setup behind the Slack AI, Notion AI and Superhuman attacks that PromptArmor published.

Build this instead:
1. Drop a file anywhere in the window to add a new ad.
2. Put "Ask about this ad" on the ad page only. It sees one version, its issues and its rules. It answers in plain text and keeps no chat history.
3. The "Request changes" note is built from the issues, with no chat involved.
4. Only if time is left: ⌘K to jump to an ad or a rule.

**The one rule:** the AI can read and answer, but it has no buttons and no write access. It can't approve, reject, change rules, or show links or images it wrote itself. Enforce this in the database, not in the prompt. Under the box, show: "Reads and answers. Can't approve, reject or change rules."

**The simpler product in one paragraph**

Ads arrive on their own from your team's connected email and drives, or you drop them in. Within a minute, each ad is checked against the law and your real rates. The problem words are quoted, the rule is named and a fix is suggested. Your Ads list puts the worst first. Open an ad, mark anything that isn't a problem, then send it back or approve it. The fixed version shows up on the same page with what changed. A person always approves one exact version, and approving with open issues takes a written reason. If your rates change, affected ads come back for review. Every step is recorded.

**Skills to install**
1. **shadcn**: keeps new screens on your existing components. `bunx --bun skills add shadcn-ui/ui -s shadcn -a claude-code -y`. Afterwards, change `npx` to `bunx --bun` in its SKILL.md.
2. **supabase**: helps get the database rules that keep workspaces apart right. `bunx --bun skills add supabase/agent-skills -s supabase -a claude-code -y`
3. **ai-sdk**: up-to-date code for version 7 of Vercel's AI library. `bunx --bun skills add vercel/ai -s ai-sdk -a claude-code -y`
4. **web-design-guidelines**: a final polish check of each screen. `bunx --bun skills add vercel-labs/agent-skills -s web-design-guidelines -a claude-code -y`
5. **break-ui**: tests screens with worst-case data. `bunx --bun skills add emilkowalski/skills -s break-ui -a claude-code -y`

You already have design:ux-copy, security-review and claude-in-chrome. I skipped "impeccable" because its live mode can launch Claude with permission checks turned off. I also skipped two other skills because they need Node, which this Mac doesn't have.

**Sources:** docs.stripe.com/radar/reviews · linear.app/docs/triage-intelligence · vercel.com/docs/agent/chat/dashboard · vercel.com/docs/deployments/promoting-a-deployment · support.ramp.com/employee-mailbox-integration · developer.apple.com/videos/play/wwdc2025/404 · simonwillison.net/2025/jun/16/the-lethal-trifecta · promptarmor.com/resources/superhuman-ai-exfiltrates-emails
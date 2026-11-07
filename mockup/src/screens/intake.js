/* screens/intake.js: Intake (Triage, New submission, Sources).
   Routes: #intake-triage, #intake-new, #intake-sources (and #intake, which shows Triage).
   Email scope: connectors only READ mail and files. Nothing here sends email. */
(function () {
  'use strict';
  var A = window.App;
  if (!A) return;
  var ui = A.ui, esc = A.esc, icon = A.icon;

  /* ------------------------------------------------------------------ */
  /* Module CSS (tokens only)                                            */
  /* ------------------------------------------------------------------ */
  var CSS = `
.ik-health { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); font-size: 12.5px; min-width: 0; }
.ik-health-item { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.ik-health .ik-health-link { margin-left: auto; font-size: 12.5px; }
.ik-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ik-item { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); min-width: 0; }
.ik-item.is-active { border-color: color-mix(in oklch, var(--foreground) 45%, transparent); box-shadow: 0 0 0 1px color-mix(in oklch, var(--foreground) 16%, transparent); }
.ik-head { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 10px 12px 4px; border: 0; background: none; color: inherit; font: inherit; text-align: left; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.ik-head:hover .ik-title { text-decoration: underline; text-underline-offset: 3px; }
.ik-head:focus-visible { outline-offset: -2px; }
.ik-main { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.ik-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ik-sub { font-size: 12px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ik-meta { display: flex; align-items: center; gap: 8px; flex: none; }
.ik-time { font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ik-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 0 12px 10px 44px; font-size: 12.5px; min-width: 0; }
.ik-reason { color: var(--muted-foreground); min-width: 0; overflow-wrap: anywhere; }
.ik-infer { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 0 8px; border: 1px dashed var(--border); border-radius: 999px; font-size: 12px; color: var(--foreground); }
.ik-infer svg.i { width: 13px; height: 13px; color: var(--muted-foreground); }
.ik-infer.is-confirmed { border-style: solid; }
.ik-infer.is-confirmed svg.i { color: var(--success); }
.ik-infer .btn-link { font-size: 12px; }
.ik-body { display: flex; flex-direction: column; gap: 12px; padding: 12px 12px 12px 44px; border-top: 1px solid var(--border); min-width: 0; }
.ik-label { font-size: 11.5px; font-weight: 500; color: var(--muted-foreground); }
.ik-cands { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ik-cand { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; min-width: 0; }
.ik-cand > svg.i { color: var(--muted-foreground); }
.ik-cand.is-excluded .ik-cand-name { text-decoration: line-through; color: var(--muted-foreground); }
.ik-confirm { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 12px; }
.ik-confirm .field { flex: 1 1 160px; max-width: 240px; }
.ik-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ik-decline { display: inline-flex; align-items: center; gap: 4px; }
.ik-decline .select { width: auto; max-width: 210px; }
.ik-new { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.ik-drop { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; font: inherit; cursor: pointer; }
.ik-drop:hover { border-color: color-mix(in oklch, var(--foreground) 35%, transparent); color: var(--foreground); }
.ik-drop > svg.i { width: 22px; height: 22px; }
.ik-cell-err { display: inline-block; padding: 0 4px; border-radius: 4px; background: var(--danger-bg); color: var(--danger); box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--danger) 40%, transparent); }
.ik-map { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px 12px; }
.ik-map .label { font-family: var(--font-mono); font-size: 11.5px; }
.ik-prov-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.ik-mono { display: inline-grid; place-items: center; width: 30px; height: 30px; flex: none; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--muted); color: var(--foreground); font: 600 14px/1 var(--font-sans); }
.ik-mono svg.i { width: 15px; height: 15px; }
.ik-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.ik-svc { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-md); }
.ik-svc > li { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; padding: 7px 10px; border-bottom: 1px solid var(--border); font-size: 12.5px; min-width: 0; }
.ik-svc > li:last-child { border-bottom: 0; }
.ik-svc-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--muted-foreground); font-size: 12px; font-variant-numeric: tabular-nums; }
.ik-consent { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--background); overflow: hidden; }
.ik-consent-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--muted); color: var(--muted-foreground); font-size: 12px; }
.ik-consent-body { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; }
.ik-consent-title { font-size: 16px; font-weight: 600; line-height: 1.35; }
.ik-acct { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; max-width: 100%; padding: 2px 10px 2px 2px; border: 1px solid var(--border); border-radius: 999px; font-size: 12.5px; overflow-wrap: anywhere; }
.ik-perms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ik-perms > li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
.ik-perms > li > svg.i { margin-top: 2px; color: var(--muted-foreground); }
.ik-ol { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.ik-mini { border-style: dashed; }
.ik-kbd-hint { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 12px; color: var(--muted-foreground); }
.ik-radio-row { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); }
.ik-radio-row:has(input:checked) { border-color: var(--foreground); }
.ik-opts { display: flex; flex-direction: column; gap: 6px; padding-left: 24px; }
@media (max-width: 1180px) { .ik-prov-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .ik-new { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 860px) { .ik-prov-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) {
  .ik-summary, .ik-body { padding-left: 12px; }
  .ik-head { flex-wrap: wrap; }
  .ik-meta { width: 100%; padding-left: 32px; }
  .ik-health .ik-health-link { margin-left: 0; }
}
`;
  function ensureCss() {
    try {
      if (!document.head || document.querySelector('style[data-module="intake.js"]')) return;
      var el = document.createElement('style');
      el.setAttribute('data-module', 'intake.js');
      el.textContent = CSS;
      document.head.appendChild(el);
    } catch (e) { /* head not available yet; retried on render */ }
  }
  ensureCss();

  /* ------------------------------------------------------------------ */
  /* Constants and sample content                                        */
  /* ------------------------------------------------------------------ */
  var MODEL = 'claude-haiku-4-5';
  var PRODUCTS = [
    { value: 'personal_loan', label: 'Personal loan' },
    { value: 'credit_card', label: 'Credit card' },
    { value: 'mortgage', label: 'Mortgage' }
  ];
  var CHANNELS = [
    { value: 'paid_social', label: 'Paid social' },
    { value: 'display', label: 'Display' },
    { value: 'email', label: 'Email' },
    { value: 'landing_page', label: 'Landing page' },
    { value: 'affiliate_post', label: 'Affiliate post' },
    { value: 'direct_mail', label: 'Direct mail' },
    { value: 'sms', label: 'SMS' },
    { value: 'paid_search', label: 'Paid search' }
  ];
  function labelIn(list, v) {
    var f = list.find(function (x) { return x.value === v; });
    return f ? f.label : (v ? String(v).replace(/_/g, ' ') : '');
  }
  function productLabel(v) { return labelIn(PRODUCTS, v); }
  function channelLabel(v) { return labelIn(CHANNELS, v); }
  function normChoice(list, raw) {
    var r = String(raw || '').trim().toLowerCase();
    if (!r) return null;
    var hit = list.find(function (x) { return x.value === r || x.label.toLowerCase() === r || x.value.replace(/_/g, ' ') === r; });
    return hit ? hit.value : null;
  }

  var CLASS = {
    'marketing': { label: 'Marketing', tone: 'blue', icon: 'tag' },
    'not-marketing': { label: 'Not marketing', tone: 'gray', icon: 'circle-slash' },
    'uncertain': { label: 'Uncertain', tone: 'amber', icon: 'help' },
    'duplicate': { label: 'Duplicate', tone: 'slate', icon: 'layers' },
    'new-version': { label: 'New version', tone: 'violet', icon: 'git-compare' }
  };
  var DECLINE_REASONS = ['Not marketing', 'Internal or personal email', 'Third-party newsletter', 'Brand asset, no ad copy', 'Already in review', 'Other'];
  var PRE_STEPS = ['Extracting text', 'Matching offers', 'Checking rules', 'Scanning for hidden instructions'];
  var SUPPORTED = ['png', 'jpg', 'jpeg', 'pdf', 'html', 'htm', 'eml', 'txt', 'text'];
  var SMART = {
    google: 'Smart watch: detect marketing submissions across mail and Drive (recommended)',
    microsoft: 'Smart watch: detect marketing submissions across mail and OneDrive (recommended)'
  };

  function sec(id, label, text) { return { id: id, label: label, text: text }; }

  // Content used when a seeded Triage item is accepted, split or attached as a version.
  var DRAFTS = {
    'I-203': { format: 'email', subject: 'Fwd: Q4 offsite lunch order', sections: [sec('s1', 'Email body', 'Menu attached. Send your order to Dana by Thursday.')] },
    'I-204': { format: 'text', sections: [sec('s1', 'Sheet "Colors"', '14 rows of hex codes and font names. No ad copy or offer terms.')] },
    'I-207': {
      campaignId: 'c-q4-debt',
      candidates: [
        { title: 'Q4 Debt Payoff display ad 300x250', product: 'personal_loan', channel: 'display', format: 'image',
          sections: [sec('s1', 'Headline', 'Pay off your cards faster.'), sec('s2', 'Offer', 'Personal loans from 6.99% APR.'), sec('s3', 'Call to action', 'Check your rate')],
          visual: { layout: 'display-300x250', headline: 'Pay off your cards faster.', subhead: 'Personal loans from 6.99% APR.', cta: 'Check your rate', footnote: '', palette: { bg: '#0B3C5D', fg: '#FFFFFF', accent: '#F2C14E' } } },
        { title: 'Q4 Debt Payoff display ad 728x90', product: 'personal_loan', channel: 'display', format: 'image',
          sections: [sec('s1', 'Headline', 'One payment. One due date.'), sec('s2', 'Offer', 'Pay as little as $189/month.'), sec('s3', 'Call to action', 'Check your rate')],
          visual: { layout: 'display-300x250', headline: 'One payment. One due date.', subhead: 'Pay as little as $189/month.', cta: 'Check your rate', footnote: '', palette: { bg: '#FFFFFF', fg: '#0B3C5D', accent: '#2A9D8F' } } },
        { title: 'Q4 Debt Payoff email body copy', product: 'personal_loan', channel: 'email', format: 'email', subject: 'Your plan to pay off cards in 2027',
          sections: [
            sec('s1', 'Subject', 'Your plan to pay off cards in 2027'),
            sec('s2', 'Body', 'Roll your card balances into one fixed-rate ClearPath Personal Loan. Rates from 8.99% to 35.99% APR, $2,000 to $40,000, 24 to 60 month terms. Checking your rate won\'t affect your credit score.'),
            sec('s3', 'Footer', 'ClearPath Financial, 100 Example Ave, Austin, TX 78701. Unsubscribe')
          ] },
        null
      ]
    },
    'I-211': {
      candidates: [
        { title: 'LoanFinder Deals "Best balance transfer cards" post', product: 'credit_card', channel: 'affiliate_post', format: 'html',
          sections: [
            sec('s1', 'Headline', 'Best balance transfer cards of 2026'),
            sec('s2', 'ClearPath listing', 'ClearPath Balance Transfer Card: 0% for 18 months on balance transfers and a $0 balance transfer fee. Our #1 pick.'),
            sec('s3', 'Link', 'loanfinderdeals.example/bt-cards')
          ] },
        { title: 'LoanFinder Deals Cash+ comparison table', product: 'credit_card', channel: 'affiliate_post', format: 'html',
          sections: [
            sec('s1', 'Headline', 'Cash+ vs. other cash back cards'),
            sec('s2', 'ClearPath row', 'ClearPath Cash+: 2% cash back, no annual fee, 0% intro APR for 15 months on purchases, then 20.24% to 29.99% variable APR.'),
            sec('s3', 'Disclosure', 'Advertiser disclosure: LoanFinder Deals earns a commission when you apply.')
          ] },
        null
      ]
    },
    'I-208': { visual: { headline: 'Your ClearPath Financial refinance offer', subhead: 'See if you prequalify to refinance.', cta: 'Call ClearPath Home by Nov 30', footnote: 'ClearPath Financial NMLS #000000. Equal Housing Lender. Not affiliated with any government agency.', seal: false } }
  };

  // New arrivals used by "Sync now" and by discovery after connecting an account.
  var ARRIVALS = {
    story: {
      provider: 'gmail', kind: 'email', title: 'Brightline: Cash+ holiday story ad (1080x1920) for review', sender: 'Brightline Media <ops@brightline-media.example>',
      snippet: 'Story-format ad for the Cash+ holiday push. Final copy is in the image.', classification: 'marketing', reason: 'Credit card offer with a 0% rate claim and a call to action.',
      candidates: [{ name: 'cashplus_story_1080x1920.png', type: 'png', sizeKb: 296 }], inferred: { product: 'credit_card', channel: 'paid_social' },
      draft: { title: 'Cash+ holiday story ad 1080x1920', format: 'image', campaignId: 'c-holiday',
        sections: [sec('s1', 'Headline', 'Holiday cash back, made simple.'), sec('s2', 'Offer', '0% APR for 15 months. No annual fee.'), sec('s3', 'Call to action', 'Apply now')],
        visual: { layout: 'social-portrait', headline: 'Holiday cash back, made simple.', subhead: '0% APR for 15 months. No annual fee.', cta: 'Apply now', footnote: '', palette: { bg: '#7A1F2B', fg: '#FFFFFF', accent: '#F6D365' } } }
    },
    landing: {
      provider: 'google-drive', kind: 'file', title: 'q4_payoff_landing_v3.html', sender: 'Priya Shah (Drive owner)',
      snippet: 'Marketing / Q4 Debt Payoff. Modified today.', classification: 'marketing', reason: 'Personal loan landing page with an APR range and a funding-speed claim.',
      candidates: [{ name: 'q4_payoff_landing_v3.html', type: 'html', sizeKb: 41 }], inferred: { product: 'personal_loan', channel: 'landing_page' },
      draft: { title: 'Q4 Debt Payoff landing page v3', format: 'html', campaignId: 'c-q4-debt',
        sections: [sec('s1', 'Hero', 'Get funds as soon as tomorrow.'), sec('s2', 'Rates', 'Rates from 8.99% to 35.99% APR. Loans from $2,000 to $40,000.'), sec('s3', 'Credit check', 'No credit check to see your rate.')],
        visual: { layout: 'landing', headline: 'Get funds as soon as tomorrow.', subhead: 'Rates from 8.99% to 35.99% APR.', cta: 'Check your rate', footnote: 'No credit check to see your rate.', palette: { bg: '#FFFFFF', fg: '#0B3C5D', accent: '#2A9D8F' } } }
    },
    postcard: {
      provider: 'gmail', kind: 'email', title: 'Re: refi postcard proof', sender: 'LoanFinder Deals <partners@loanfinderdeals.example>',
      snippet: 'Here is the low-res proof. Print files next week.', classification: 'uncertain', reason: 'Mentions a postcard proof, but the only attachment is a 40 KB JPG with no readable text.',
      candidates: [{ name: 'postcard_proof_small.jpg', type: 'jpg', sizeKb: 40 }], inferred: { product: 'mortgage', channel: 'direct_mail' },
      draft: { title: 'Refi postcard proof (low resolution)', format: 'image', sections: [sec('s1', 'Image text', 'No readable text found in the image.')] }
    },
    branch: {
      provider: 'outlook', kind: 'email', title: 'Branch flyer: holiday mortgage rates', sender: 'Daniel Kim <daniel.kim@clearpathfinancial.example>',
      snippet: 'Branches want to print this Monday. Can compliance look first?', classification: 'marketing', reason: 'Mortgage rate claim with a call to action.',
      candidates: [{ name: 'holiday_rates_flyer.pdf', type: 'pdf', sizeKb: 640 }], inferred: { product: 'mortgage', channel: 'direct_mail' },
      draft: { title: 'Branch holiday mortgage rates flyer', format: 'pdf',
        sections: [sec('s1', 'Headline', 'Holiday rates are here.'), sec('s2', 'Offer', '30-year fixed from 5.875%. Stop by any ClearPath Home branch.'), sec('s3', 'Footer', 'ClearPath Financial NMLS #000000.')] }
    },
    ratesTable: {
      provider: 'onedrive', kind: 'file', title: 'ClearPath_Home_rates_table.xlsx', sender: 'Daniel Kim (OneDrive owner)',
      snippet: 'Sheet "Today": 6 rows of rates and APRs.', classification: 'uncertain', reason: 'Rate table with no ad copy. It may feed a landing page.',
      candidates: [{ name: 'ClearPath_Home_rates_table.xlsx', type: 'xlsx', sizeKb: 22 }], inferred: { product: 'mortgage', channel: null },
      draft: { title: 'ClearPath Home rates table', format: 'text', sections: [sec('s1', 'Sheet "Today"', '30-year fixed 6.375% (6.477% APR). 15-year fixed 5.625% (5.791% APR).')] }
    }
  };

  var GROUPS = {
    google: {
      id: 'google', name: 'Google', mono: 'G', services: ['gmail', 'google-drive', 'google-sheets'], blurb: 'Gmail, Google Drive and Google Sheets', illustrative: false,
      reads: [['gmail', 'Messages and attachments'], ['google-drive', 'Files you can access'], ['google-sheets', 'Sheets with creative links or copy']],
      consentNote: 'Google asks twice, back to back: once for Gmail and once for Drive.',
      consents: [
        { service: 'Gmail', scopes: [{ icon: 'mail', text: 'Read your email messages and settings' }], note: 'Read-only. Nango can\'t send, delete or change your mail.' },
        { service: 'Google Drive', scopes: [{ icon: 'drive', text: 'See and download all your Google Drive files' }, { icon: 'sheet', text: 'See all your Google Sheets spreadsheets' }], note: 'Read-only. Nango can\'t edit, share or delete your files.' }
      ],
      discoverSteps: ['Signed in through Nango', 'Reading the last 90 days of Gmail', 'Scanning Drive files you can access', 'Finding sheets with creative links', 'Classifying: rules first, AI only when unsure'],
      discovery: {
        scanned: 'Scanned 2,914 messages and 1,208 files from the last 90 days.', notMarketing: 4119,
        arrivals: ['story', 'landing', 'postcard'],
        skipped: [
          { provider: 'gmail', title: 'Benefits enrollment closes Friday', reason: 'Internal HR notice. No product, offer or call to action. Rule-based pre-check, no AI cost.' },
          { provider: 'google-drive', title: 'Q3 board deck.pdf', reason: 'Internal presentation. No consumer-facing offer.' }
        ],
        logs: {
          'gmail': 'Initial discovery: scanned 90 days (2,914 messages). Found 1 likely submission and 1 uncertain; skipped 2,912 as not marketing.',
          'google-drive': 'Initial discovery: scanned 1,208 files you can access. Found 1 likely submission; skipped 1,207.',
          'google-sheets': 'Initial discovery: found 1 tracker sheet with creative links. No new rows.'
        }
      },
      narrow: [
        { kind: 'Gmail labels', items: ['Compliance Review', 'Partners/Brightline', 'Partners/LoanFinder'] },
        { kind: 'Drive folders', items: ['Marketing / Q4 Debt Payoff', 'Marketing / Cash+', 'Marketing / ClearPath Home'] }
      ]
    },
    microsoft: {
      id: 'microsoft', name: 'Microsoft', mono: 'M', services: ['outlook', 'onedrive', 'excel'], blurb: 'Outlook, OneDrive and Excel', illustrative: true,
      reads: [['outlook', 'Messages and attachments'], ['onedrive', 'Files you can access'], ['excel', 'Workbooks with creative links or copy']],
      consentNote: 'Microsoft asks once for mail and files.',
      consents: [
        { service: 'Outlook, OneDrive and Excel', scopes: [{ icon: 'mail', text: 'Read your mail' }, { icon: 'drive', text: 'Read all files that you can access' }, { icon: 'refresh', text: 'Maintain access to data you have given it access to' }], note: 'Read-only. Nango can\'t send mail or change files.' }
      ],
      discoverSteps: ['Signed in through Nango', 'Reading the last 90 days of Outlook', 'Scanning OneDrive files you can access', 'Finding workbooks with creative links', 'Classifying: rules first, AI only when unsure'],
      discovery: {
        scanned: 'Scanned 640 messages and 312 files from the last 90 days.', notMarketing: 950,
        arrivals: ['branch', 'ratesTable'],
        skipped: [{ provider: 'outlook', title: 'Quarterly planning', reason: 'Internal meeting notes. No product, offer or call to action. Rule-based pre-check, no AI cost.' }],
        logs: {
          'outlook': 'Initial discovery: scanned 90 days (640 messages). Found 1 likely submission; skipped 639 as not marketing.',
          'onedrive': 'Initial discovery: scanned 312 files you can access. Found 1 uncertain; skipped 311.',
          'excel': 'Initial discovery: no workbooks with creative links.'
        }
      },
      narrow: [
        { kind: 'Outlook folders', items: ['Inbox / Compliance', 'Partners'] },
        { kind: 'OneDrive folders', items: ['Marketing', 'Branch materials'] }
      ]
    }
  };

  // New submission samples: each click on the dropzone adds the next one.
  var SAMPLE_FILES = [
    { name: 'cashplus_holiday_story_1080x1920.png', type: 'png', sizeKb: 312, product: 'credit_card', channel: 'paid_social', draft: ARRIVALS.story.draft },
    { name: 'q4_payoff_landing_v3.html', type: 'html', sizeKb: 41, product: 'personal_loan', channel: 'landing_page', draft: ARRIVALS.landing.draft },
    { name: 'refi_postcard_back.pdf', type: 'pdf', sizeKb: 880, product: 'mortgage', channel: 'direct_mail',
      draft: { title: 'Refi postcard (back)', format: 'pdf',
        sections: [sec('s1', 'Headline', 'Refinance at 5.99% fixed.'), sec('s2', 'Body', 'Call ClearPath Home today to lock your rate.'), sec('s3', 'Footer', 'ClearPath Financial NMLS #000000.')],
        visual: { layout: 'mailer-letter', headline: 'Refinance at 5.99% fixed.', subhead: 'Call ClearPath Home today to lock your rate.', cta: 'Call today', footnote: 'ClearPath Financial NMLS #000000.', palette: { bg: '#F7F3E8', fg: '#1B1B1B', accent: '#1F4E79' } } } },
    { name: 'brand_sizzle_reel.mp4', type: 'mp4', sizeKb: 18400, unsupported: 'Video: stored, not reviewed by AI',
      draft: { title: 'Brand sizzle reel (video)', format: 'text', sections: [sec('s1', 'File', 'brand_sizzle_reel.mp4 (18.4 MB video). Stored as received; not reviewed by AI.')] } }
  ];
  var PASTE_EXAMPLE = {
    headline: '',
    body: 'ClearPath: Good news, Jordan! You\'re approved for up to $15,000. Rates from 7.99% APR. Tap to claim: cpf.example/l/8KQ2',
    disclosures: 'Reply STOP to opt out',
    cta: 'Tap to claim'
  };
  var CSV = {
    name: 'affiliate_batch_nov.csv', sizeKb: 3,
    columns: ['offer_line', 'creative_text', 'fine_print', 'cta', 'product', 'placement', 'affiliate'],
    rows: [
      ['Personal loans up to $40,000', 'Compare rates in minutes. Rates 8.99% to 35.99% APR. Checking your rate won\'t affect your credit score.', 'LoanFinder Deals is paid by ClearPath Financial when you apply.', 'See my rate', 'personal_loan', 'affiliate_post', 'LoanFinder Deals'],
      ['Guaranteed approval, any credit', 'Bad credit? No problem. Get approved today with ClearPath.', '', 'Apply now', 'personal_loan', 'display', 'LoanFinder Deals'],
      ['Cash+ 2% cash back', '', '', 'Learn more', 'credit_card', 'paid_social', 'LoanFinder Deals']
    ]
  };
  var MAP_FIELDS = [
    { value: 'headline', label: 'Headline' }, { value: 'body', label: 'Body copy' }, { value: 'disclosures', label: 'Disclosures' },
    { value: 'cta', label: 'Call to action' }, { value: 'product', label: 'Product' }, { value: 'channel', label: 'Channel' },
    { value: 'partner', label: 'Partner' }, { value: 'ignore', label: 'Ignore' }
  ];
  var DEFAULT_MAP = { offer_line: 'headline', creative_text: 'body', fine_print: 'disclosures', cta: 'cta', product: 'product', placement: 'channel', affiliate: 'partner' };

  /* ------------------------------------------------------------------ */
  /* Screen-local state (in memory)                                      */
  /* ------------------------------------------------------------------ */
  function fresh() {
    return {
      tab: 'pending', sel: null, declineReason: {}, flash: null, focusId: null,
      newTab: 'upload', files: [], sampleIdx: 0,
      paste: { headline: '', body: '', disclosures: '', cta: '' },
      imp: { loaded: false, map: A.clone(DEFAULT_MAP) },
      meta: { product: '', channel: '', states: '', campaignId: '', partnerId: '', dueDate: defaultDue(), audience: '' },
      run: null, result: null,
      flow: null, gap: {}, logFilter: 'all'
    };
  }
  var st = null;
  var timers = [];
  function later(fn, ms) {
    var id = setTimeout(function () {
      timers = timers.filter(function (t) { return t !== id; });
      try { fn(); } catch (e) { if (window.console) console.error('[intake] timer failed', e); }
    }, ms);
    timers.push(id);
    return id;
  }
  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); }); timers = []; }

  A.on('reset', function () { clearTimers(); st = fresh(); });
  A.on('profile-changed', function () {
    st.sel = null; st.flash = null; st.result = null; st.run = null; st.files = []; st.tab = 'pending';
    st.meta.campaignId = ''; st.meta.partnerId = '';
  });

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function S() { return A.state; }
  function pid() { return S().activeProfileId; }
  function me() { return A.me(); }
  function round4(n) { return Math.round(n * 10000) / 10000; }
  function profileById(id) { return S().profiles.find(function (p) { return p.id === id; }) || null; }
  function itemById(id) { return S().intake.find(function (i) { return i.id === id && i.profileId === pid(); }) || null; }
  function defaultDue() {
    var t = (A.state && A.state.meta && A.state.meta.today) || '2026-11-06';
    var d = new Date(t + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 4);
    return d.toISOString().slice(0, 10);
  }
  function tomorrowNine() {
    var t = (A.state && A.state.meta && A.state.meta.today) || '2026-11-06';
    var d = new Date(t + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10) + 'T09:00:00-06:00';
  }
  function minutesAgo(m) { return new Date(A.nowMs() - m * 60000).toISOString(); }
  function parseSender(s) {
    s = String(s || '');
    var m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
    if (m) return { name: m[1] || m[2], email: m[2] };
    var e = /([^\s()<>]+@[^\s()<>]+)/.exec(s);
    return { name: s.replace(/\s*\(.*\)\s*$/, '') || 'Unknown sender', email: e ? e[1] : '' };
  }
  function providerOf(it) { var s = A.sourceById(it.sourceId); return s ? s.provider : 'upload'; }
  function providerLabel(p) { var m = A.labels.SOURCES[p]; return m ? m.label : (p || 'Source'); }
  function isMail(p) { return p === 'gmail' || p === 'outlook'; }
  function activeCands(it) { return (it.candidates || []).filter(function (c) { return !c.excludedReason; }); }
  function isConfirmed(it) { var f = it.inferred || {}; return !!(f.confirmed && f.product && f.channel); }
  function actionable(it) { return it && (it.status === 'pending' || it.status === 'snoozed'); }
  function sectionsText(secs) { return (secs || []).map(function (s) { return s.text || ''; }).join('\n'); }
  function rr() {
    var c = A.current();
    if (c && c.name && (/^intake/.test(c.name) || c.name === 'dashboard' || c.name === 'queue' || c.name === 'asset' || c.name === 'reports')) A.rerender();
  }
  function srcLabel(it) {
    var p = providerOf(it), snd = parseSender(it.sender);
    return providerLabel(p) + ': "' + it.title + '" from ' + (snd.email || snd.name);
  }
  function typeIcon(t) {
    t = String(t || '').toLowerCase();
    if (t === 'png' || t === 'jpg' || t === 'jpeg' || t === 'gif') return 'image';
    if (t === 'pdf') return 'file-text';
    if (t === 'xlsx' || t === 'csv' || t === 'sheet-row') return 'sheet';
    if (t === 'text') return 'message';
    return 'file';
  }
  function fmtSize(kb) {
    if (kb == null) return '';
    if (kb >= 1024) return (Math.round(kb / 102.4) / 10) + ' MB';
    return kb + ' KB';
  }
  function maxN(a) { return (a.versions || []).reduce(function (m, v) { return Math.max(m, v.n || 0); }, 0); }
  function classBadge(c) {
    var m = CLASS[c] || { label: c || 'Unclassified', tone: 'gray', icon: 'circle' };
    return '<span class="badge tone tone-' + m.tone + '">' + icon(m.icon) + '<span>' + esc(m.label) + '</span></span>';
  }
  function btn(label, action, o) {
    o = o || {};
    return ui.button(label, { action: action, data: o.data, variant: o.variant || 'outline', size: o.size || 'sm', icon: o.icon, kbd: o.kbd, disabled: o.disabled, id: o.id, title: o.title, iconOnly: o.iconOnly, attrs: o.attrs });
  }
  function selectField(label, id, options, value, o) {
    o = o || {};
    return ui.field(label, ui.select(id, options, value, { change: o.change, data: o.data, size: o.size, disabled: o.disabled }), { id: id, optional: o.optional, hint: o.hint });
  }
  function sevCounts(findings) {
    var c = { critical: 0, major: 0, minor: 0 };
    (findings || []).forEach(function (f) { if (c[f.severity] != null && A.isOpenFinding(f)) c[f.severity] += 1; });
    return c;
  }
  function countsText(c) {
    var parts = [];
    if (c.critical) parts.push(c.critical + ' Critical');
    if (c.major) parts.push(c.major + ' Major');
    if (c.minor) parts.push(c.minor + ' Minor');
    return parts.length ? parts.join(', ') : 'no issues flagged';
  }
  function sevSummaryHtml(c) {
    var out = ['critical', 'major', 'minor'].filter(function (k) { return c[k]; }).map(function (k) {
      return '<span class="row row-tight">' + ui.severityBadge(k) + '<span class="num small">' + c[k] + '</span></span>';
    }).join('');
    return out ? '<span class="row row-wrap">' + out + '</span>' : '<span class="small muted">No issues flagged</span>';
  }
  function words(s) {
    var out = {};
    String(s || '').toLowerCase().replace(/[^a-z0-9$%.]+/g, ' ').split(' ').forEach(function (w) { if (w.length >= 3) out[w] = 1; });
    return out;
  }
  function overlap(a, b) {
    var wa = words(a), wb = words(b), inter = 0, union = 0, k;
    for (k in wa) { union += 1; if (wb[k]) inter += 1; }
    for (k in wb) { if (!wa[k]) union += 1; }
    return union ? Math.round(inter / union * 100) : 0;
  }

  /* ------------------------------------------------------------------ */
  /* IDs, rules, offers                                                  */
  /* ------------------------------------------------------------------ */
  function nextRunId() {
    var ids = [];
    S().assets.forEach(function (a) { (a.versions || []).forEach(function (v) { if (v.run && v.run.id) ids.push(v.run.id); }); });
    S().costLedger.forEach(function (c) { if (c.runId) ids.push(c.runId); });
    return A.nextId('R', ids, 5500);
  }
  function nextAssetId() { return A.nextId('A', S().assets.map(function (a) { return a.id; }), 100); }
  function nextIntakeId() { return A.nextId('I', S().intake.map(function (i) { return i.id; }), 200); }
  function rulesFor(profileId, product) {
    var own = S().rules.filter(function (r) { return r.profileId === profileId && (r.appliesTo || []).indexOf(product) >= 0; });
    if (own.length) return own;
    return S().rules.filter(function (r) { return r.profileId == null && (r.appliesTo || []).indexOf(product) >= 0; });
  }
  function ruleV(id) { var r = A.ruleById(id); var v = r && A.ruleVersion(r); return v ? v.v : 1; }
  function offerTerms(id) { var o = A.offerById(id); var v = o && A.offerVersion(o); return v ? (v.terms || {}) : {}; }
  function offerSnapshot(product) {
    var ids = product === 'credit_card' ? ['CC-1', 'CC-2'] : product === 'mortgage' ? ['MG-1'] : ['PL-1'];
    return ids.map(function (id) {
      var o = A.offerById(id), v = o && A.offerVersion(o);
      if (!v) return null;
      return id + ' v' + v.v + (v.terms && v.terms.rateSheet ? ' (' + v.terms.rateSheet + ')' : '');
    }).filter(Boolean);
  }
  function campaignsFor(profileId) { return S().campaigns.filter(function (c) { return c.profileId === profileId; }); }
  function campaignIn(profileId, id) { return id && campaignsFor(profileId).some(function (c) { return c.id === id; }) ? id : null; }

  /* ------------------------------------------------------------------ */
  /* Preflight simulation (deterministic, canned)                        */
  /* ------------------------------------------------------------------ */
  function analyze(o) {
    var out = { findings: [], alerts: [], coverage: {} };
    var secs = (o.sections || []).filter(function (s) { return s && s.text; });
    var full = sectionsText(secs) + (o.subject ? '\n' + o.subject : '');
    var last = secs[secs.length - 1], first = secs[0];
    var product = o.product, channel = o.channel;
    out.coverage = {
      copy: o.unsupported ? 'Not checked' : 'Checked',
      image: o.format === 'image' ? 'OCR 1/1' : (o.format === 'pdf' ? 'PDF text layer' : 'No images'),
      disclosures: o.unsupported ? 'Not checked' : 'Checked',
      stateLaw: (o.states && o.states.length) ? 'Not covered (' + o.states.join(', ') + ')' : 'Not covered',
      links: /(\.example\/|https?:)/i.test(full) ? 'Link not followed' : 'No links'
    };
    if (channel === 'sms') out.coverage.consent = 'SMS consent (TCPA): not covered';
    if (o.unsupported) { out.coverage.video = 'Not covered'; return out; }

    function hit(re) {
      for (var i = 0; i < secs.length; i++) {
        var m = re.exec(secs[i].text);
        if (m) return { s: secs[i], q: m[0].trim() };
      }
      return null;
    }
    function F(ruleId, severity, evidenceType, h, title, explanation, fix, copy, fallbackSec) {
      out.findings.push({
        ruleId: ruleId, ruleVersion: ruleV(ruleId), severity: severity, evidenceType: evidenceType,
        sectionId: h && h.s ? h.s.id : ((fallbackSec || last || first || { id: 's1' }).id),
        quote: h && h.q ? h.q : null, verifiedSpan: !!(h && h.q),
        title: title, explanation: explanation, suggestedFix: fix, suggestedCopy: copy || null,
        disposition: null, dispositionNote: null
      });
    }

    // Approval or guarantee claims (all products).
    var appr = hit(/\b(?:you(?:'|’)?re|you are)\s+(?:pre-?)?approved\b[^.!?]*[.!?]?|\bguaranteed approval\b|\bget approved today\b|\bpre-?approved\b|\bguaranteed\b/i);
    if (appr) F('CP-UDAAP-01', 'critical', 'exact-match', appr, '"Approved" or "guaranteed" before underwriting',
      'Nobody has applied or been underwritten yet, so the ad can\'t promise approval. ClearPath offers a soft-pull rate check, not an approval.',
      'Invite the reader to check their rate instead.', 'Check your rate. It won\'t affect your credit score.');

    // Rates against the offer catalog.
    var flaggedRate = {}, noAprFlagged = false;
    var pl = offerTerms('PL-1'), mg = offerTerms('MG-1'), cc1 = offerTerms('CC-1'), cc2 = offerTerms('CC-2');
    secs.forEach(function (s) {
      var re = /(\d{1,2}(?:\.\d{1,3})?)\s?%(\s*(?:intro(?:ductory)?\s+)?APR)?/gi, m;
      while ((m = re.exec(s.text))) {
        var val = parseFloat(m[1]);
        var after = s.text.slice(m.index + m[0].length, m.index + m[0].length + 22);
        var before = s.text.slice(Math.max(0, m.index - 16), m.index);
        if (/^\s*(\(|of\b|origination|fee|cash|back|off\b|down|ltv|transfer fee)/i.test(after) || /origination|down payment/i.test(before)) continue;
        var hasApr = !!m[2] || /^\s*(APR|annual percentage rate)/i.test(after);
        var ctxRate = hasApr || /rate|from|as low as|starting|fixed|apr/i.test(before + after);
        if (product === 'personal_loan' && pl.aprMin != null && ctxRate && (val < pl.aprMin - 0.001 || val > pl.aprMax + 0.001) && !flaggedRate[val]) {
          flaggedRate[val] = 1;
          F('CP-PL-01', 'critical', 'offer-mismatch', { s: s, q: m[0].trim() }, val + '% APR is not offered',
            'Offer PL-1 ranges from ' + pl.aprMin + '% to ' + pl.aprMax + '% APR. ' + val + '% is outside that range, so the ad states a term that isn\'t available.',
            'Use the current offer range.', 'Rates from ' + pl.aprMin + '% to ' + pl.aprMax + '% APR');
        }
        if (product === 'mortgage' && mg.rate30Fixed != null && !flaggedRate[val]) {
          var allowed = [mg.rate30Fixed, mg.apr30Fixed, mg.rate15Fixed, mg.apr15Fixed].filter(function (x) { return x != null; });
          if (!allowed.some(function (x) { return Math.abs(x - val) < 0.001; })) {
            flaggedRate[val] = 1;
            F('CP-MG-03', 'critical', 'offer-mismatch', { s: s, q: m[0].trim() }, val + '% is not on the current rate sheet',
              'Rate sheet ' + (mg.rateSheet || '') + ' lists 30-year fixed at ' + mg.rate30Fixed + '% (' + mg.apr30Fixed + '% APR). ' + val + '% isn\'t offered.',
              'Use the current rate sheet and show the APR with its assumptions.', 'Today\'s 30-year fixed: ' + mg.rate30Fixed + '% rate (' + mg.apr30Fixed + '% APR)');
          }
        }
        if ((product === 'personal_loan' || product === 'mortgage') && !hasApr && ctxRate && !/APR/i.test(s.text) && !noAprFlagged) {
          noAprFlagged = true;
          F('CP-PL-03', 'major', 'exact-match', { s: s, q: m[0].trim() }, 'Rate shown without an APR',
            'A finance-charge rate must be stated as an annual percentage rate (12 CFR 1026.24(c)).', 'Show the APR next to the rate.', null);
        }
        if (product === 'credit_card') {
          if (val === 0) {
            var phrase = /^0\s?%(?:\s*(?:intro(?:ductory)?\s*)?APR)?(?:\s+(?:for|on)\s+\d+\s+months)?/i.exec(s.text.slice(m.index));
            var ctx = before + m[0] + after;
            if (!/intro/i.test(ctx) && !flaggedRate.intro) {
              flaggedRate.intro = 1;
              F('CP-CC-01', 'critical', 'exact-match', { s: s, q: (phrase ? phrase[0] : m[0]).trim() }, '0% rate without "intro"',
                'A promotional rate needs "intro" or "introductory" right next to it, plus when it ends and the APR that applies after (12 CFR 1026.16(g)).',
                'Label the rate as intro and say how long it lasts.', '0% intro APR for ' + (cc1.introMonths || 15) + ' months on purchases');
            }
            if (!/(then|after)[^.]*\d+\.\d+%|variable APR/i.test(full) && !flaggedRate.goto) {
              flaggedRate.goto = 1;
              var bt = /balance transfer/i.test(full) ? cc2 : cc1;
              F('CP-CC-01', 'major', 'missing-disclosure', null, 'Intro rate without the APR that applies after',
                'The ad states a promotional rate but not the go-to APR that applies when it ends.', 'Add the go-to APR with equal prominence.',
                'Then ' + bt.goToAprMin + '% to ' + bt.goToAprMax + '% variable APR.', s);
            }
          } else if (hasApr && !flaggedRate[val]) {
            var lo = Math.min(cc1.goToAprMin || 99, cc2.goToAprMin || 99), hi = Math.max(cc1.goToAprMax || 0, cc2.goToAprMax || 0);
            if (val < lo - 0.001 || val > hi + 0.001) {
              flaggedRate[val] = 1;
              F('CP-CC-03', 'critical', 'offer-mismatch', { s: s, q: m[0].trim() }, val + '% APR is not a ClearPath card rate',
                'ClearPath card APRs range from ' + lo + '% to ' + hi + '% variable. ' + val + '% isn\'t offered.', 'Use the catalog APR range.', null);
            }
          }
        }
      }
    });

    if (product === 'credit_card') {
      var btFee = hit(/\$0 balance transfer fee|no balance transfer fee/i);
      if (btFee) F('CP-CC-03', 'critical', 'offer-mismatch', btFee, 'Balance transfer fee is not $0',
        'Offer CC-2 charges ' + (cc2.balanceTransferFee || '3% of each transfer (min $5)') + '. The ad says there is no fee.', 'State the actual balance transfer fee.', (cc2.balanceTransferFee || '3% of each transfer (min $5)') + ' balance transfer fee');
      var naf = hit(/no annual fee/i);
      if (naf && !/(then|after)[^.]*\d+\.\d+%|variable APR/i.test(full)) F('CP-CC-02', 'major', 'missing-disclosure', naf, '"No annual fee" without the APRs',
        '"No annual fee" is a triggering term for open-end credit, so the ad must also give the APRs and other required fees (12 CFR 1026.16(b)).',
        'Add the APR and fee disclosures next to the claim, or link to the full terms.', null);
    }

    if (product === 'personal_loan' || product === 'mortgage') {
      var pay = hit(/\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:\/\s*mo(?:nth)?\b|a month\b|per month\b|monthly\b)/i);
      if (pay && (!/APR/i.test(full) || !/\d+[- ]month|months|years?\b/i.test(full))) F('CP-PL-02', 'major', 'missing-disclosure', pay, 'Payment amount without repayment terms and APR',
        'A payment amount is a triggering term, so the ad must also state the repayment terms and the APR (12 CFR 1026.24(d)).',
        'Add the repayment terms and APR next to the payment, or remove the payment amount.', null);
    }
    if (product === 'personal_loan' || product === 'credit_card') {
      var ncc = hit(/no credit check/i);
      if (ncc) F(product === 'personal_loan' ? 'CP-PL-01' : 'CP-CC-03', 'critical', 'offer-mismatch', ncc, '"No credit check" is not true',
        'ClearPath checks credit: a soft inquiry to check a rate and a hard inquiry when an offer is accepted.', 'Describe the soft inquiry accurately.', 'Checking your rate won\'t affect your credit score.');
    }
    if (product === 'personal_loan') {
      var fund = hit(/(?:as soon as|by)\s+tomorrow|same[- ]day (?:funding|funds)|funds? (?:today|tomorrow)|get (?:your )?(?:money|funds|cash) (?:today|tomorrow)/i);
      if (fund) F('CP-PL-01', 'major', 'needs-judgment', fund, 'Funding speed is faster than the catalog',
        'Offer PL-1 says funds arrive ' + (pl.fundingTime || '1 to 3 business days after approval') + '. Decide whether "tomorrow" is accurate for typical applicants.',
        'Match the catalog funding time.', 'Funds typically arrive 1 to 3 business days after approval.');
    }
    if (product === 'mortgage') {
      var gov = hit(/official notice|federal [a-z ]*(?:program|relief)|government[- ](?:backed|program)|program for homeowners/i);
      if (gov) F('CP-MG-01', 'critical', 'exact-match', gov, 'Implies a government program',
        'Dwelling-secured ads may not misrepresent government endorsement (12 CFR 1026.24(i)(3)).', 'Remove the government framing and say who the offer is from.', 'Your ClearPath Financial refinance offer.');
      if (!/equal housing/i.test(full)) F('CP-MG-04', 'minor', 'missing-disclosure', null, 'Equal Housing Lender legend missing',
        'This profile requires the NMLS ID and the Equal Housing Lender legend on every mortgage ad.', 'Add the legend to the footer.', 'Equal Housing Lender.');
    }
    if (channel === 'affiliate_post' || o.partnerType === 'affiliate') {
      if (!/(affiliate|advertis|commission|paid by|compensat|sponsored|we earn|earns)/i.test(full)) F('CP-AFF-01', 'critical', 'missing-disclosure', null, 'Material connection not disclosed',
        'An affiliate is paid when readers apply, so the connection must be disclosed next to the link or claim (16 CFR 255.5).', 'Add a disclosure next to the ClearPath listing.',
        'We earn a commission from ClearPath Financial if you apply through our links.', first);
      var rank = hit(/#1 pick|number one pick|unbiased/i);
      if (rank) F('CP-AFF-02', 'major', 'needs-judgment', rank, 'Ranking claim from a paid affiliate',
        'A paid affiliate calls ClearPath its top pick. Decide whether the ranking reads as independent when it isn\'t.', 'Remove the ranking or explain how it was decided.', null);
    }
    if (channel === 'email' && !/unsubscribe|opt out/i.test(full)) F('CP-EML-01', 'major', 'missing-disclosure', null, 'No unsubscribe link or postal address',
      'Commercial email needs a working opt-out and a valid postal address (CAN-SPAM).', 'Confirm the send template adds them, or add them to the copy.', 'Unsubscribe');
    if (channel === 'sms' && !/\bSTOP\b/.test(full)) F('LIB-SMS-01', 'minor', 'missing-disclosure', null, 'No opt-out instruction',
      'Marketing texts should identify the sender and say how to opt out.', 'Add the opt-out line.', 'Reply STOP to opt out');
    if ((channel === 'sms' || channel === 'direct_mail') && product !== 'mortgage' && !String(o.audience || '').trim()) F('LIB-PRESCREEN-01', 'major', 'needs-judgment', null, 'Missing information: audience',
      'No audience or targeting was given. If this goes to people picked from a credit report list (a prescreened offer), it needs the prescreen opt-out notice. Add the audience so the right rules apply.',
      'Add the audience in the asset details.', null, first);

    var inj = hit(/ignore (?:all |any )?(?:previous|prior|above) instructions|ai reviewer|return status|mark (?:this|it) (?:as )?approved|you are an? (?:ai|assistant|language model)/i);
    if (inj) out.alerts.push({ kind: 'possible-injection', text: inj.q, how: 'Visible text addressed to an automated reviewer. Treated as content, not followed.', acknowledged: false, sectionId: inj.s.id });
    var zw = null;
    secs.some(function (s) { if (/[​-‍⁠﻿]/.test(s.text)) { zw = s; return true; } return false; });
    if (zw) out.alerts.push({ kind: 'hidden-text', text: 'Zero-width characters in "' + zw.label + '"', how: 'Zero-width characters are invisible to people. Treated as content, not followed.', acknowledged: false, sectionId: zw.id });

    var rank2 = { critical: 3, major: 2, minor: 1 };
    out.findings.sort(function (x, y) { return (rank2[y.severity] || 0) - (rank2[x.severity] || 0); });
    return out;
  }

  function buildChecklist(profileId, product, channel, findings, format, partnerType) {
    var flagged = {};
    (findings || []).forEach(function (f) { flagged[f.ruleId] = 1; });
    var rows = rulesFor(profileId, product).map(function (r) {
      var res = 'pass';
      if (flagged[r.id]) res = 'flagged';
      else if (/EML/.test(r.id) && channel !== 'email') res = 'na';
      else if (/SMS/.test(r.id) && channel !== 'sms') res = 'na';
      else if (/AFF/.test(r.id) && !(channel === 'affiliate_post' || partnerType === 'affiliate')) res = 'na';
      else if (/UDAAP-02/.test(r.id) || (/DISC/.test(r.id) && (format === 'image' || format === 'pdf'))) res = 'not-checked';
      return { ruleId: r.id, result: res };
    });
    Object.keys(flagged).forEach(function (id) { if (!rows.some(function (r) { return r.ruleId === id; })) rows.push({ ruleId: id, result: 'flagged' }); });
    return rows;
  }

  function chargeRun(a, v, tokensIn, tokensOut) {
    var prof = profileById(a.profileId), b = (prof && prof.budget) || {};
    var cost = round4((tokensIn * 1 + tokensOut * 5) / 1e6);
    var over = (b.profileCapUsd != null && (b.profileSpentTodayUsd || 0) + cost > b.profileCapUsd) ||
      (b.globalCapUsd != null && (b.globalSpentTodayUsd || 0) + cost > b.globalCapUsd);
    if (over) return { over: true, cost: 0 };
    b.profileSpentTodayUsd = round4((b.profileSpentTodayUsd || 0) + cost);
    b.globalSpentTodayUsd = round4((b.globalSpentTodayUsd || 0) + cost);
    S().costLedger.push({ at: A.nowIso(), runId: v.run.id, assetId: a.id, model: v.run.model, tokensIn: tokensIn, tokensOut: tokensOut, costUsd: cost, cached: false });
    return { over: false, cost: cost };
  }

  // Creates an asset with V1 and a running preflight. Call completePreflight(id) to finish it.
  function newAsset(o) {
    var profileId = o.profileId || pid();
    var id = nextAssetId();
    var now = A.nowIso();
    var rules = rulesFor(profileId, o.product);
    var v = {
      id: id + '-v1', n: 1, createdAt: now, origin: o.origin || 'upload', authorName: o.authorName || me().name, sha: A.shortSha(),
      content: { format: o.format || 'text', sections: A.clone(o.sections || []) },
      run: {
        id: nextRunId(), at: now, model: MODEL, tokensIn: 0, tokensOut: 0, costUsd: 0, seeded: false, simulated: true, status: 'running',
        offerSnapshot: offerSnapshot(o.product), coverage: { copy: 'Running', disclosures: 'Running', image: 'Running', stateLaw: 'Not covered', links: 'Running' }
      },
      findings: [], checklist: [], securityAlerts: []
    };
    if (o.subject) v.content.subject = o.subject;
    if (o.visual) v.content.visual = A.clone(o.visual);
    if (o.unsupported) v.run.skipReason = o.unsupported;
    var a = {
      id: id, profileId: profileId, title: o.title || 'Untitled submission', product: o.product, channel: o.channel,
      campaignId: campaignIn(profileId, o.campaignId), partnerId: o.partnerId || null,
      submitter: o.submitter || { name: me().name, email: me().email, kind: 'member' },
      states: o.states || [], dueDate: o.dueDate || defaultDue(), audience: o.audience || '',
      status: 'preflighting', subLabel: 'Checking against ' + rules.length + ' rules',
      approvedVersionId: null, latestVersionId: v.id, flags: {}, sourceRefs: o.sourceRefs || [],
      versions: [v], decisions: [], changeRequests: [], events: [], chat: [], createdAt: now, intakeId: o.intakeId || null
    };
    S().assets.push(a);
    A.log(id, o.actorName || me().name, 'intake', o.intakeText || 'Submitted in New submission.');
    A.log(id, 'System', 'preflight', 'Preflight ' + v.run.id + ' started against ' + rules.length + ' rules.');
    A.emit('data-changed', { kind: 'asset', assetId: id });
    return a;
  }

  function completePreflight(id) {
    var a = A.asset(id, { anyProfile: true });
    if (!a) return null;
    var v = A.latestVersion(a);
    if (!v || !v.run || v.run.status !== 'running') return null;
    var partner = a.partnerId ? A.partnerById(a.partnerId, a.profileId) : null;
    var skip = v.run.skipReason || null;
    var res = analyze({ sections: v.content.sections, subject: v.content.subject, product: a.product, channel: a.channel, partnerType: partner ? partner.type : null,
      audience: a.audience, format: v.content.format, states: a.states, unsupported: !!skip });
    var num = String(a.id).replace(/\D/g, '');
    res.findings.forEach(function (f, k) { f.id = 'F' + num + '-' + v.n + '-' + (k + 1); });
    var rules = rulesFor(a.profileId, a.product);
    v.findings = res.findings;
    v.securityAlerts = res.alerts;
    v.run.coverage = res.coverage;
    v.checklist = skip ? rules.map(function (r) { return { ruleId: r.id, result: 'not-checked' }; }) :
      buildChecklist(a.profileId, a.product, a.channel, res.findings, v.content.format, partner ? partner.type : null);
    var text = sectionsText(v.content.sections);
    var tIn = skip ? 0 : 6400 + Math.round(text.length / 3.6) + rules.length * 140;
    var tOut = skip ? 0 : 240 + res.findings.length * 170;
    var charge = skip ? { over: false, cost: 0 } : chargeRun(a, v, tIn, tOut);
    v.run.at = A.nowIso();
    if (charge.over) {
      v.run.status = 'failed';
      v.run.failReason = 'Run declined: it would exceed the daily AI cap. Deterministic checks still ran.';
    } else {
      v.run.status = 'complete';
      v.run.tokensIn = tIn; v.run.tokensOut = tOut; v.run.costUsd = charge.cost;
      if (skip) v.run.note = 'Not reviewed by AI. ' + skip + '.';
    }
    var counts = sevCounts(res.findings);
    var hidden = res.alerts.some(function (al) { return al.kind !== 'possible-injection'; });
    if (skip || charge.over || hidden) {
      a.status = 'needs-manual-review';
      a.subLabel = skip ? skip : charge.over ? 'AI run declined (daily cap)' : 'Hidden text found';
      if (skip) a.flags.extractionFailed = true;
      if (hidden) a.flags.securityAlert = true;
    } else {
      a.status = 'needs-review';
      a.subLabel = res.findings.length ? 'Has findings' : 'No issues flagged';
    }
    if (res.alerts.some(function (al) { return al.kind === 'possible-injection'; })) a.flags.possibleInjection = true;
    var offers = (v.run.offerSnapshot || []).join(', ') || 'the offer catalog';
    if (skip) A.log(a.id, 'System', 'preflight', 'Preflight ' + v.run.id + ' skipped AI review: ' + skip + '. Routed to Needs manual review. $0.00.');
    else if (charge.over) A.log(a.id, 'System', 'preflight', 'Preflight ' + v.run.id + ': AI run declined because it would exceed the daily cap. Deterministic checks ran. Routed to Needs manual review.');
    else A.log(a.id, 'System', 'preflight', 'Preflight ' + v.run.id + ' finished against ' + rules.length + ' rules and ' + offers + '. ' + ui.money(charge.cost) + '.');
    if (!skip) A.log(a.id, 'System', 'finding', res.findings.length ? A.plural(res.findings.length, 'finding') + ': ' + countsText(counts) + '.' : 'No issues flagged. Rules marked Not checked stay with the reviewer.');
    res.alerts.forEach(function (al) {
      A.log(a.id, 'System', 'finding', (al.kind === 'possible-injection' ? 'Possible injection: ' : 'Security alert: ') + al.text + '. Treated as content, not followed.');
    });
    A.emit('data-changed', { kind: 'preflight', assetId: a.id });
    return { asset: a, counts: counts, findings: res.findings.length };
  }

  function schedulePreflight(ids, base) {
    (ids || []).forEach(function (id, k) {
      later(function () {
        var r = completePreflight(id);
        if (!r) return;
        A.toast('Preflight finished on ' + id + ': ' + countsText(r.counts) + '.', r.counts.critical ? 'warning' : 'success');
        rr();
      }, (base || 1600) + k * 450);
    });
  }

  // Adds findings that the analyzer sees on a new version and the carried findings don't cover.
  function addNewFindings(a, nv) {
    var partner = a.partnerId ? A.partnerById(a.partnerId, a.profileId) : null;
    var res = analyze({ sections: nv.content.sections, subject: nv.content.subject, product: a.product, channel: a.channel, partnerType: partner ? partner.type : null,
      audience: a.audience, format: nv.content.format, states: a.states });
    var open = nv.findings.filter(function (f) { return f.recheck !== 'resolved'; });
    var num = String(a.id).replace(/\D/g, '');
    var added = [];
    res.findings.forEach(function (f) {
      var dup = open.some(function (e) { return e.ruleId === f.ruleId && (f.quote == null || normEq(e.quote, f.quote)); });
      if (dup) return;
      f.id = 'F' + num + '-' + nv.n + '-' + (nv.findings.length + 1);
      f.recheck = 'new';
      nv.findings.push(f);
      added.push(f);
    });
    if (added.length) A.log(a.id, 'System', 'finding', A.plural(added.length, 'new finding') + ' on V' + nv.n + ': ' + countsText(sevCounts(added)) + '.');
    return added;
  }
  function normEq(x, y) { return A.normText(x || '') === A.normText(y || ''); }
  function recheckCounts(nv) {
    var c = { resolved: 0, still: 0, fresh: 0 };
    nv.findings.forEach(function (f) { if (f.recheck === 'resolved') c.resolved += 1; else if (f.recheck === 'new') c.fresh += 1; else c.still += 1; });
    return c;
  }
  function patchVersionEvent(a, nv) {
    var c = recheckCounts(nv);
    for (var i = a.events.length - 1; i >= 0; i--) {
      var ev = a.events[i];
      if (ev.kind === 'version' && ev.text.indexOf('V' + nv.n + ' created') === 0) {
        ev.text = ev.text.replace(/sha [0-9a-f]+/, 'sha ' + nv.sha).replace(/recheck: \d+ resolved, \d+ still present/, 'recheck: ' + c.resolved + ' resolved, ' + c.still + ' still present');
        break;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Triage data                                                         */
  /* ------------------------------------------------------------------ */
  var TAB_FILTER = {
    pending: function (i) { return i.status === 'pending'; },
    snoozed: function (i) { return i.status === 'snoozed'; },
    declined: function (i) { return i.status === 'declined'; },
    processed: function (i) { return i.status === 'accepted' || i.status === 'merged' || i.status === 'split'; }
  };
  function profileItems(profileId) { return S().intake.filter(function (i) { return i.profileId === profileId; }); }
  function byTab(tab) {
    return profileItems(pid()).filter(TAB_FILTER[tab] || TAB_FILTER.pending)
      .sort(function (x, y) { return A.toMs(y.receivedAt) - A.toMs(x.receivedAt); });
  }
  function tabCounts(profileId) {
    var items = profileItems(profileId), c = {};
    Object.keys(TAB_FILTER).forEach(function (k) { c[k] = items.filter(TAB_FILTER[k]).length; });
    return c;
  }
  function ensureSel(list) {
    if (!list.some(function (i) { return i.id === st.sel; })) st.sel = list.length ? list[0].id : null;
  }
  function afterAction(prevList, id) {
    var idx = prevList.findIndex(function (i) { return i.id === id; });
    var list = byTab(st.tab);
    st.sel = list.length ? list[Math.max(0, Math.min(idx, list.length - 1))].id : null;
    if (st.sel) st.focusId = 'ik-head-' + st.sel;
  }
  function dupHint(it) {
    var a = it.duplicateOf ? A.asset(it.duplicateOf) : null;
    if (!a) return 'Duplicate';
    var provs = (a.sourceRefs || []).map(function (r) { var s = A.sourceById(r.sourceId); return s ? s.provider : null; }).filter(Boolean);
    if (it.status !== 'merged') provs.push(providerOf(it));
    var kinds = provs.filter(function (p, i) { return provs.indexOf(p) === i; });
    if (kinds.length === 1) return 'Seen in ' + provs.length + ' ' + (isMail(kinds[0]) ? 'messages' : 'files');
    return 'Same file in ' + kinds.map(providerLabel).join(' and ');
  }
  function overlapFromReason(it) { var m = /(\d+)% text overlap/.exec(it.reason || ''); return m ? parseInt(m[1], 10) : null; }
  function defaultDeclineReason(it) {
    if (it.classification === 'duplicate') return 'Already in review';
    if (/newsletter|weekly/i.test(it.title)) return 'Third-party newsletter';
    if (/palette|brand|logo/i.test(it.title)) return 'Brand asset, no ad copy';
    if (/lunch|offsite|planning|agenda/i.test(it.title)) return 'Internal or personal email';
    return 'Not marketing';
  }
  function itemText(it) {
    var d = DRAFTS[it.id] || it.draft || {};
    var parts = [it.title, it.snippet];
    if (it.revision) parts.push(sectionsText(it.revision.sections));
    if (d.sections) parts.push(sectionsText(d.sections));
    return parts.join(' ');
  }
  function candidateDraft(it, idx) {
    var d = DRAFTS[it.id];
    if (idx != null) {
      if (d && d.candidates && d.candidates[idx]) return d.candidates[idx];
      var c = (it.candidates || [])[idx] || { name: 'Item ' + (idx + 1), type: 'text' };
      var fmt = typeIcon(c.type) === 'image' ? 'image' : (c.type === 'pdf' ? 'pdf' : 'text');
      return { title: it.title + ': ' + c.name, format: fmt, sections: [sec('s1', c.name, it.snippet || c.name)] };
    }
    if (it.draft) return it.draft;
    if (d && d.sections) return d;
    if (d && d.candidates) {
      var sections = [];
      d.candidates.forEach(function (cd) {
        if (!cd) return;
        cd.sections.forEach(function (s) { sections.push(sec('s' + (sections.length + 1), cd.title.replace(/^Q4 Debt Payoff |^LoanFinder Deals /, '') + ' · ' + s.label, s.text)); });
      });
      return { title: it.title, format: it.kind === 'email' ? 'email' : 'html', subject: it.kind === 'email' ? it.title : undefined, sections: sections, campaignId: d.campaignId };
    }
    return { title: it.title, format: it.kind === 'email' ? 'email' : 'text', subject: it.kind === 'email' ? it.title : undefined,
      sections: [sec('s1', it.kind === 'email' ? 'Email body' : 'Extracted text', it.snippet || it.title)] };
  }
  function submitterFor(it) {
    var prof = profileById(it.profileId) || {};
    var snd = parseSender(it.sender);
    var dom = (snd.email.split('@')[1] || '').toLowerCase();
    var p = (prof.partners || []).find(function (x) {
      var pd = (String(x.contactEmail || '').split('@')[1] || '').toLowerCase();
      return (dom && pd && dom === pd) || String(x.name).toLowerCase() === String(snd.name).toLowerCase();
    });
    if (p) return { submitter: { name: p.name, email: p.contactEmail, kind: 'partner' }, partnerId: p.id };
    var u = S().users.find(function (x) { return (snd.email && x.email.toLowerCase() === snd.email.toLowerCase()) || x.name === snd.name; });
    if (u) return { submitter: { name: u.name, email: u.email, kind: 'member' }, partnerId: null };
    return { submitter: { name: snd.name || snd.email || 'Unknown sender', email: snd.email || '', kind: 'partner' }, partnerId: null };
  }
  function createFromIntake(it, opt) {
    opt = opt || {};
    var who = submitterFor(it);
    var draft = candidateDraft(it, opt.candidateIndex);
    var prov = providerOf(it);
    var snd = parseSender(it.sender);
    var cands = activeCands(it);
    var which = opt.candidateIndex != null ? ', creative ' + (cands.indexOf(it.candidates[opt.candidateIndex]) + 1) + ' of ' + cands.length + ' (' + it.candidates[opt.candidateIndex].name + ')' : '';
    return newAsset({
      profileId: it.profileId, title: draft.title || it.title, product: opt.product, channel: opt.channel,
      campaignId: opt.campaignId !== undefined ? opt.campaignId : (draft.campaignId || null),
      partnerId: who.partnerId, submitter: who.submitter,
      origin: isMail(prov) ? 'email' : 'sync', authorName: who.submitter.name,
      format: draft.format, subject: draft.subject, sections: draft.sections, visual: draft.visual,
      sourceRefs: [{ sourceId: it.sourceId, label: srcLabel(it), seenAt: it.receivedAt }], intakeId: it.id,
      intakeText: 'Accepted in Triage from ' + it.id + ': ' + providerLabel(prov) + ' ' + (it.kind === 'email' ? 'message' : it.kind === 'sheet-row' ? 'sheet rows' : 'file') +
        ' "' + it.title + '" from ' + (snd.email || snd.name) + which + '. Product (' + productLabel(opt.product) + ') and channel (' + channelLabel(opt.channel) + ') confirmed by ' + me().name + '.',
      actorName: me().name
    });
  }

  /* ------------------------------------------------------------------ */
  /* Triage actions                                                      */
  /* ------------------------------------------------------------------ */
  function finishAction(prev, it, flash) {
    if (flash) st.flash = flash;
    afterAction(prev, it.id);
    A.emit('data-changed', { kind: 'intake', id: it.id });
    A.rerender();
  }
  function focusMeta(it) {
    st.sel = it.id;
    st.focusId = 'ik-prod-' + it.id;
    A.rerender();
  }
  function confirmItem(it) {
    if (!actionable(it)) return;
    if (it.newVersionOf || it.duplicateOf) { A.toast('Product and channel come from ' + (it.newVersionOf || it.duplicateOf) + '.', 'info'); return; }
    var f = it.inferred = it.inferred || {};
    if (!f.product || !f.channel) { A.toast('Choose a product and a channel first.', 'warning'); focusMeta(it); return; }
    f.confirmed = true; f.confirmedBy = me().id; f.confirmedAt = A.nowIso();
    A.emit('data-changed', { kind: 'intake', id: it.id });
    A.toast('Confirmed for ' + it.id + ': ' + productLabel(f.product) + ' · ' + channelLabel(f.channel), 'success');
    st.sel = it.id;
    A.rerender();
  }
  function acceptItem(it, opts) {
    opts = opts || {};
    if (!actionable(it)) return;
    if (!opts.separate) {
      if (it.newVersionOf && A.asset(it.newVersionOf)) { applyNewVersion(it, it.newVersionOf); return; }
      if (it.duplicateOf) { A.toast(it.id + ' looks like a duplicate of ' + it.duplicateOf + '. Press 3 to merge, or use More to accept it as a separate asset.', 'info'); return; }
    }
    if (!isConfirmed(it)) {
      A.toast('Accept is blocked until product and channel are confirmed.', 'warning');
      focusMeta(it);
      return;
    }
    var prev = byTab(st.tab);
    var a = createFromIntake(it, { product: it.inferred.product, channel: it.inferred.channel });
    it.status = 'accepted'; it.assetId = a.id; it.decidedBy = me().id; it.decidedAt = A.nowIso();
    A.logProfile(me().name, 'intake', 'Accepted ' + it.id + ' as ' + a.id + ': ' + it.title);
    A.toast('Accepted ' + it.id + ' as ' + a.id + '. Preflight is running.', 'success');
    finishAction(prev, it, { variant: 'success', title: 'Accepted as ' + a.id, body: esc(a.title) + ' · preflight running. It shows up in the Queue when it finishes.', links: [{ label: 'Open ' + a.id, href: '#asset-' + a.id, icon: 'arrow-right' }] });
    schedulePreflight([a.id]);
  }
  function declineItem(it) {
    if (!actionable(it)) return;
    var reason = st.declineReason[it.id] || defaultDeclineReason(it);
    var prev = byTab(st.tab), prevStatus = it.status;
    it.status = 'declined'; it.declinedBy = me().id; it.declinedReason = reason; it.declinedAt = A.nowIso();
    A.logProfile(me().name, 'intake', 'Declined ' + it.id + ' (' + reason + '): ' + it.title);
    A.toast('Declined ' + it.id + '. Restore it any time from the Declined tab.');
    finishAction(prev, it, { variant: 'neutral', title: 'Declined ' + it.id, body: esc(it.title) + ' · ' + esc(reason) + '.', undo: { id: it.id, status: prevStatus } });
  }
  function snoozeItem(it) {
    if (!it || it.status !== 'pending') { if (it && it.status === 'snoozed') A.toast(it.id + ' is already snoozed.', 'info'); return; }
    var prev = byTab(st.tab);
    it.status = 'snoozed'; it.snoozedUntil = tomorrowNine(); it.snoozedBy = me().id;
    A.logProfile(me().name, 'intake', 'Snoozed ' + it.id + ' until ' + ui.time(it.snoozedUntil) + ': ' + it.title);
    A.toast('Snoozed ' + it.id + ' until ' + ui.time(it.snoozedUntil) + '.');
    finishAction(prev, it, { variant: 'neutral', title: 'Snoozed ' + it.id, body: 'Back in Needs triage ' + esc(ui.time(it.snoozedUntil)) + '. Find it in the Snoozed tab until then.', undo: { id: it.id, status: 'pending' } });
  }
  function mergeItem(it) {
    if (!actionable(it)) return;
    if (!it.duplicateOf) { A.toast(it.id + ' is not marked as a duplicate. Use Accept, or More > New version of an existing asset.', 'info'); return; }
    var a = A.asset(it.duplicateOf);
    if (!a) { A.toast(it.duplicateOf + ' is not in this profile.', 'error'); return; }
    var prev = byTab(st.tab);
    var snd = parseSender(it.sender), prov = providerOf(it);
    var shaM = /sha ([0-9a-f]{6,})/.exec(it.reason || '');
    a.sourceRefs.push({ sourceId: it.sourceId, label: srcLabel(it), seenAt: it.receivedAt });
    it.status = 'merged'; it.assetId = a.id; it.decidedBy = me().id; it.decidedAt = A.nowIso();
    var hint = dupHint(it);
    A.log(a.id, me().name, 'merge', 'Merged ' + it.id + ' from Triage: the same file' + (shaM ? ' (sha ' + shaM[1] + ')' : '') + ' in another ' + (isMail(prov) ? 'message' : 'source') +
      ' from ' + (snd.email || snd.name) + '. Added as a second source; no new version. ' + hint + '.');
    A.logProfile(me().name, 'intake', 'Merged ' + it.id + ' into ' + a.id + '.');
    A.toast('Merged ' + it.id + ' into ' + a.id + '. ' + hint + '.', 'success');
    finishAction(prev, it, { variant: 'success', title: 'Merged into ' + a.id, body: esc(a.title) + ' · ' + esc(hint) + '. No new version, so nothing to re-review.', links: [{ label: 'Open ' + a.id, href: '#asset-' + a.id, icon: 'arrow-right' }] });
  }
  function mapSectionsOnto(a, draftSecs) {
    var cur = (A.latestVersion(a) || { content: { sections: [] } }).content.sections || [];
    var out = [];
    draftSecs.forEach(function (s, i) {
      if (cur[i]) out.push({ id: cur[i].id, label: s.label || cur[i].label, text: s.text });
      else out.push({ id: 's' + (cur.length + out.length + 1), label: s.label, text: s.text });
    });
    for (var j = draftSecs.length; j < cur.length; j++) out.push({ id: cur[j].id, text: '' });
    return out;
  }
  function applyNewVersion(it, assetId) {
    if (!actionable(it)) return;
    var a = A.asset(assetId);
    if (!a) { A.toast(assetId + ' is not in this profile.', 'error'); return; }
    var prev = byTab(st.tab);
    var prov = providerOf(it), who = submitterFor(it);
    var suggested = assetId === it.newVersionOf && it.revision;
    var sections = suggested ? A.clone(it.revision.sections) : mapSectionsOnto(a, candidateDraft(it).sections || []);
    var nv = A.newVersion(a.id, { origin: isMail(prov) ? 'email' : 'sync', sections: sections, authorName: who.submitter.name });
    if (!nv) return;
    nv.content.sections = nv.content.sections.filter(function (s) { return s.text && String(s.text).trim(); });
    if (suggested) {
      if (it.revision.sha) nv.sha = it.revision.sha;
      (it.revision.recheck || []).forEach(function (r) {
        var f = nv.findings.find(function (x) { return x.carriedFrom === r.carriedFrom; });
        if (f) f.recheck = r.recheck;
      });
      nv.findings = nv.findings.filter(function (f) { return f.recheck !== 'resolved' || (it.revision.recheck || []).some(function (r) { return r.carriedFrom === f.carriedFrom; }); });
    }
    var d = DRAFTS[it.id];
    if (d && d.visual && nv.content.visual) Object.assign(nv.content.visual, d.visual);
    patchVersionEvent(a, nv);
    addNewFindings(a, nv);
    if (!a.sourceRefs.some(function (r) { return r.sourceId === it.sourceId && r.seenAt === it.receivedAt; })) a.sourceRefs.push({ sourceId: it.sourceId, label: srcLabel(it), seenAt: it.receivedAt });
    var ov = assetId === it.newVersionOf ? overlapFromReason(it) : overlap(itemText(it), sectionsText((a.versions[a.versions.length - 2] || nv).content.sections));
    A.log(a.id, me().name, 'intake', 'Matched ' + it.id + ' in Triage as V' + nv.n + ' (' + (isMail(prov) ? 'reply in the same ' + providerLabel(prov) + ' thread' : 'same ' + providerLabel(prov) + ' file') +
      (ov != null ? ', ' + ov + '% text overlap' : '') + '). Confirmed by ' + me().name + '.');
    it.status = 'accepted'; it.assetId = a.id; it.versionId = nv.id; it.decidedBy = me().id; it.decidedAt = A.nowIso();
    A.logProfile(me().name, 'intake', 'Added ' + it.id + ' as ' + a.id + ' V' + nv.n + '.');
    var c = recheckCounts(nv);
    var line = 'Recheck: ' + c.resolved + ' resolved, ' + c.still + ' still present, ' + c.fresh + ' new.';
    A.emit('data-changed', { kind: 'version', assetId: a.id });
    A.toast(a.id + ' V' + nv.n + ' added. ' + line, 'success');
    finishAction(prev, it, { variant: 'recheck', title: a.id + ' V' + nv.n + ' added from ' + providerLabel(prov), body: esc(a.title) + ' · ' + esc(line) + ' Status is Recheck ready.',
      links: [{ label: 'Compare V' + (nv.n - 1) + ' and V' + nv.n, href: '#compare-' + a.id, icon: 'git-compare' }, { label: 'Open ' + a.id, href: '#asset-' + a.id, icon: 'arrow-right' }] });
  }

  /* ------------------------------------------------------------------ */
  /* Triage rendering                                                    */
  /* ------------------------------------------------------------------ */
  function header(active) {
    var counts = tabCounts(pid());
    return '<div class="page-header"><div class="page-heading"><h1 class="page-title">Intake</h1>' +
      '<p class="page-desc">Submissions found in connected mail and drives, plus anything added directly. Nothing reaches the review queue until a member accepts it.</p></div>' +
      '</div>' +
      ui.tabs('ik-tabs', [
        { id: 'triage', label: 'Triage', count: counts.pending, icon: 'inbox' },
        { id: 'new', label: 'New submission', icon: 'upload' },
        { id: 'sources', label: 'Sources', icon: 'plug' }
      ], active, 'intake-tab', { label: 'Intake sections' });
  }

  var SRC_STATUS = {
    'connected': { label: 'Connected', dot: 'ok' },
    'syncing': { label: 'Syncing', dot: 'sync' },
    'resyncing-gap': { label: 'Resyncing after gap', dot: 'sync' },
    'needs-reconnect': { label: 'Needs reconnect', dot: 'warn' },
    'owner-removed': { label: 'Connection owner removed', dot: 'warn' },
    'error': { label: 'Error, retrying', dot: 'err' },
    'not-connected': { label: 'Not connected', dot: 'off' }
  };
  function effStatus(s) {
    if (!s) return 'not-connected';
    if (s.connectedBy && s.status !== 'not-connected' && !A.isMember(s.profileId, s.connectedBy)) return 'owner-removed';
    return s.status || 'not-connected';
  }
  function statusPill(status) {
    var m = SRC_STATUS[status] || SRC_STATUS['not-connected'];
    return '<span class="ik-status"><span class="dot dot-' + m.dot + '" aria-hidden="true"></span>' + esc(m.label) + '</span>';
  }

  function healthStrip(profileId) {
    var list = S().sources.filter(function (s) { return s.profileId === profileId && s.group !== 'direct' && effStatus(s) !== 'not-connected'; });
    if (!list.length) {
      return '<div class="ik-health">' + icon('plug') + '<span class="muted">No mail or drive connected yet.</span>' +
        '<a class="ik-health-link" href="#intake-sources">Connect Google or Microsoft</a></div>';
    }
    return '<div class="ik-health" aria-label="Source health">' + list.map(function (s) {
      var stt = effStatus(s);
      return '<span class="ik-health-item">' + ui.sourceIcon(s.provider) + '<span class="medium">' + esc(providerLabel(s.provider)) + '</span>' + (s.illustrative ? ui.illustrative() : '') + statusPill(stt) +
        (stt === 'connected' && s.lastSyncAt ? '<span class="muted small" title="' + esc(ui.time(s.lastSyncAt)) + '">' + esc(ui.relTime(s.lastSyncAt)) + '</span>' : '') + '</span>';
    }).join('') + '<a class="ik-health-link" href="#intake-sources">Manage sources</a></div>';
  }

  function flashHtml() {
    var f = st.flash;
    if (!f) return '';
    var acts = (f.links || []).map(function (l) { return ui.button(l.label, { href: l.href, size: 'sm', variant: 'outline', icon: l.icon }); }).join('') +
      (f.undo ? btn('Undo', 'intake-undo', { variant: 'ghost', icon: 'undo' }) : '') +
      btn('Dismiss', 'intake-flash-close', { variant: 'ghost', icon: 'x' });
    return ui.callout(f.variant || 'success', f.title, f.body, { actionsHtml: acts, id: 'ik-flash', role: 'status' });
  }

  function kbdHint() {
    return '<span class="ik-kbd-hint hide-mobile">' + ui.kbd('J') + ui.kbd('K') + ' move · ' + ui.kbd('1') + ' accept · ' + ui.kbd('2') + ' decline · ' +
      ui.kbd('3') + ' merge · ' + ui.kbd('H') + ' snooze</span>';
  }

  function inferHtml(it) {
    if (!actionable(it) || it.newVersionOf || it.duplicateOf) return '';
    var f = it.inferred || {};
    if (isConfirmed(it)) {
      return '<span class="ik-infer is-confirmed">' + icon('check') + '<span>' + esc(productLabel(f.product) + ' · ' + channelLabel(f.channel)) + ' · confirmed</span></span>';
    }
    if (!f.product || !f.channel) {
      var part = f.product ? 'Inferred: ' + productLabel(f.product) + ' · channel not detected' : (f.channel ? 'Inferred: ' + channelLabel(f.channel) + ' · product not detected' : 'Product and channel not detected');
      return '<span class="ik-infer">' + icon('sparkles') + '<span>' + esc(part) + '</span>' +
        ui.button('set them', { action: 'intake-focus-meta', data: { id: it.id }, variant: 'link', size: 'sm' }) + '</span>';
    }
    return '<span class="ik-infer">' + icon('sparkles') + '<span>Inferred: ' + esc(productLabel(f.product) + ' · ' + channelLabel(f.channel)) + ' ·</span>' +
      ui.button('confirm', { action: 'intake-confirm', data: { id: it.id }, variant: 'link', size: 'sm', title: 'Confirm the inferred product and channel (C)' }) + '</span>';
  }
  function hintsHtml(it) {
    var out = [];
    if (it.duplicateOf) out.push(ui.chip(dupHint(it), { icon: 'layers', size: 'sm', title: 'Duplicate of ' + it.duplicateOf }));
    if (it.newVersionOf) {
      var ov = overlapFromReason(it);
      out.push(ui.chip('New version of ' + it.newVersionOf + (ov != null ? ' · ' + ov + '% text overlap' : ''), { icon: 'git-compare', size: 'sm' }));
    }
    var n = activeCands(it).length;
    if (n > 1) out.push(ui.chip(n + ' creatives in one ' + (it.kind === 'sheet-row' ? 'sheet update' : 'message'), { icon: 'split', size: 'sm' }));
    return out.join('');
  }
  function outcomeHtml(it) {
    if (it.status === 'merged') return 'Merged into ' + assetLink(it.assetId || it.duplicateOf) + ' as a second source';
    if (it.status === 'split') return 'Split into ' + (it.assetIds || []).map(assetLink).join(', ');
    if (it.status === 'accepted') {
      if (it.versionId || it.classification === 'new-version') return 'Added as a new version of ' + assetLink(it.assetId);
      return 'Accepted as ' + assetLink(it.assetId);
    }
    if (it.status === 'declined') {
      var u = A.userById(it.declinedBy);
      return 'Declined' + (u ? ' by ' + esc(u.name) : '') + (it.declinedReason ? ' · ' + esc(it.declinedReason) : '');
    }
    if (it.status === 'snoozed') return 'Snoozed until ' + esc(ui.time(it.snoozedUntil));
    return '';
  }
  function assetLink(id) {
    if (!id) return '';
    return A.asset(id) ? '<a href="#asset-' + esc(id) + '" class="mono">' + esc(id) + '</a>' : '<span class="mono">' + esc(id) + '</span>';
  }

  function itemHtml(it, active) {
    var prov = providerOf(it), snd = parseSender(it.sender);
    var kind = it.kind === 'email' ? 'Email' : it.kind === 'sheet-row' ? 'Sheet rows' : 'File';
    var head = '<button type="button" class="ik-head" id="ik-head-' + esc(it.id) + '" data-action="intake-select" data-id="' + esc(it.id) + '" aria-expanded="' + (active ? 'true' : 'false') + '"' +
      (active ? ' aria-controls="ik-body-' + esc(it.id) + '"' : '') + '>' +
      ui.sourceIcon(prov) +
      '<span class="ik-main"><span class="ik-title">' + esc(it.title) + '</span>' +
      '<span class="ik-sub">' + esc(snd.name) + ' · ' + esc(kind) + ' via ' + esc(providerLabel(prov)) + ' · <span class="mono">' + esc(it.id) + '</span></span></span>' +
      '<span class="ik-meta">' + classBadge(it.classification) + '<span class="ik-time" title="' + esc(ui.time(it.receivedAt)) + '">' + esc(ui.relTime(it.receivedAt)) + '</span></span></button>';
    var outcome = actionable(it) && it.status !== 'snoozed' ? '' : '<span class="small">' + outcomeHtml(it) + '</span>';
    var summary = '<div class="ik-summary"><span class="ik-reason">' + esc(it.reason) + '</span>' + hintsHtml(it) + inferHtml(it) + outcome + '</div>';
    return '<div class="ik-item' + (active ? ' is-active' : '') + '" id="ik-item-' + esc(it.id) + '">' + head + summary + (active ? bodyHtml(it) : '') + '</div>';
  }

  function bodyHtml(it) {
    var parts = [];
    if (it.snippet) parts.push('<div class="stack-sm"><span class="ik-label">' + (it.kind === 'email' ? 'Message' : 'Details') + '</span><div class="quote">' + esc(it.snippet) + '</div></div>');
    if ((it.candidates || []).length) {
      parts.push('<div class="stack-sm"><span class="ik-label">' + (it.kind === 'sheet-row' ? 'Rows' : 'Attachments and content') + '</span><ul class="ik-cands">' + it.candidates.map(function (c) {
        return '<li class="ik-cand' + (c.excludedReason ? ' is-excluded' : '') + '">' + icon(typeIcon(c.type)) + '<span class="ik-cand-name">' + esc(c.name) + '</span>' +
          '<span class="muted xs">' + esc(String(c.type || '').toUpperCase()) + (c.sizeKb ? ' · ' + esc(fmtSize(c.sizeKb)) : '') + '</span>' +
          (c.excludedReason ? '<span class="badge badge-outline">' + icon('circle-slash') + '<span>Excluded: ' + esc(c.excludedReason) + '</span></span>' : '') + '</li>';
      }).join('') + '</ul></div>');
    }
    var target = it.newVersionOf ? A.asset(it.newVersionOf) : null;
    if (target && actionable(it)) {
      var ov = overlapFromReason(it), cr = (target.changeRequests || []).filter(function (c) { return c.status === 'open'; })[0];
      var rc = (it.revision && it.revision.recheck) || [];
      var res = rc.filter(function (r) { return r.recheck === 'resolved'; }).length;
      parts.push(ui.callout('recheck', 'Looks like V' + (maxN(target) + 1) + ' of ' + target.id,
        esc(target.title) + ' · ' + ui.statusBadge(target.status) + '<br>' + esc(isMail(providerOf(it)) ? 'Reply in the same ' + providerLabel(providerOf(it)) + ' thread' : 'Same file in ' + providerLabel(providerOf(it))) +
        (ov != null ? ', ' + ov + '% text overlap with V' + maxN(target) : '') + '.' +
        (cr ? ' Change request ' + esc(cr.id) + ' has ' + A.plural((cr.items || []).length, 'item') + '.' : '') +
        (rc.length ? ' A quick check suggests ' + res + ' of ' + rc.length + ' earlier findings are fixed; the recheck confirms when you add it.' : ''),
        { actionsHtml: ui.button('Open ' + target.id, { href: '#asset-' + target.id, size: 'sm', variant: 'ghost', iconRight: 'arrow-right' }) }));
    }
    if (it.duplicateOf && actionable(it)) {
      var dupA = A.asset(it.duplicateOf);
      parts.push(ui.callout('neutral', 'Duplicate of ' + it.duplicateOf, (dupA ? esc(dupA.title) + ' · ' : '') + esc(dupHint(it)) + '. Merging adds this ' + (isMail(providerOf(it)) ? 'message' : 'file') + ' as a second source on ' + esc(it.duplicateOf) + '. No new version, nothing to re-review.'));
    }
    if (actionable(it) && !it.newVersionOf && !it.duplicateOf) {
      var f = it.inferred || {};
      var conf = isConfirmed(it);
      parts.push('<div class="stack-sm"><span class="ik-label">Product and channel' + (conf ? '' : ' · confirm before accepting') + '</span><div class="ik-confirm">' +
        selectField('Product', 'ik-prod-' + it.id, [{ value: '', label: 'Choose…' }].concat(PRODUCTS), f.product || '', { change: 'intake-meta', data: { id: it.id, field: 'product' }, size: 'sm' }) +
        selectField('Channel', 'ik-chan-' + it.id, [{ value: '', label: 'Choose…' }].concat(CHANNELS), f.channel || '', { change: 'intake-meta', data: { id: it.id, field: 'channel' }, size: 'sm' }) +
        (conf ? '<span class="row row-tight small success-text">' + icon('circle-check') + '<span>Confirmed' + (f.confirmedBy && A.userById(f.confirmedBy) ? ' by ' + esc(A.userById(f.confirmedBy).name) : '') + '</span></span>'
          : btn('Confirm', 'intake-confirm', { data: { id: it.id }, icon: 'check', kbd: 'C', disabled: !(f.product && f.channel) })) +
        '</div></div>');
    }
    parts.push(actionsHtml(it));
    return '<div class="ik-body" id="ik-body-' + esc(it.id) + '">' + parts.join('') + '</div>';
  }

  function actionsHtml(it) {
    var b = [];
    var details = btn('Source details', 'intake-details', { data: { id: it.id }, variant: 'ghost', icon: 'info' });
    if (it.status === 'declined') {
      return '<div class="ik-actions">' + btn('Restore to triage', 'intake-restore', { data: { id: it.id }, icon: 'undo' }) + details + '</div>';
    }
    if (!actionable(it)) {
      var links = it.status === 'split' ? (it.assetIds || []) : [it.assetId || it.duplicateOf];
      return '<div class="ik-actions">' + links.filter(function (id) { return id && A.asset(id); }).map(function (id) {
        return ui.button('Open ' + id, { href: '#asset-' + id, size: 'sm', variant: 'outline', iconRight: 'arrow-right' });
      }).join('') + details + '</div>';
    }
    var conf = isConfirmed(it), multi = activeCands(it).length > 1;
    var target = it.newVersionOf ? A.asset(it.newVersionOf) : null;
    if (it.status === 'snoozed') b.push(btn('Unsnooze', 'intake-unsnooze', { data: { id: it.id }, icon: 'undo' }));
    if (target) b.push(btn('Add as V' + (maxN(target) + 1) + ' of ' + target.id, 'intake-newver-apply', { data: { id: it.id, assetId: target.id }, variant: 'default', icon: 'git-compare', kbd: '1' }));
    else if (it.duplicateOf) b.push(btn('Merge into ' + it.duplicateOf, 'intake-merge', { data: { id: it.id }, variant: 'default', icon: 'merge', kbd: '3' }));
    else if (multi) {
      b.push(btn('Split into ' + activeCands(it).length + ' assets', 'intake-split', { data: { id: it.id }, variant: 'default', icon: 'split', kbd: 'S' }));
      b.push(btn('Accept as one asset', 'intake-accept', { data: { id: it.id }, icon: 'check', kbd: '1', disabled: !conf }));
    } else {
      b.push(btn('Accept to review', 'intake-accept', { data: { id: it.id }, variant: it.classification === 'not-marketing' ? 'outline' : 'default', icon: 'check', kbd: '1', disabled: !conf }));
    }
    var reason = st.declineReason[it.id] || defaultDeclineReason(it);
    b.push('<span class="ik-decline"><label class="sr-only" for="ik-decline-' + esc(it.id) + '">Decline reason</label>' +
      ui.select('ik-decline-' + it.id, DECLINE_REASONS, reason, { change: 'intake-decline-reason', data: { id: it.id }, size: 'sm' }) +
      btn('Decline', 'intake-decline', { data: { id: it.id }, variant: it.classification === 'not-marketing' ? 'default' : 'outline', icon: 'x', kbd: '2' }) + '</span>');
    if (it.status === 'pending') b.push(btn('Snooze', 'intake-snooze', { data: { id: it.id }, variant: 'ghost', icon: 'clock', kbd: 'H' }));
    b.push(btn('More actions', 'intake-more', { data: { id: it.id }, variant: 'ghost', icon: 'more', iconOnly: true, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }));
    var html = '<div class="ik-actions">' + b.join('') + '</div>';
    if (!conf && !target && !it.duplicateOf) html += '<p class="hint row row-tight">' + icon('lock') + '<span>Accept is blocked until product and channel are confirmed.</span></p>';
    return html;
  }

  function emptyFor(tab) {
    var anySrc = S().sources.some(function (s) { return s.profileId === pid() && s.group !== 'direct' && effStatus(s) !== 'not-connected'; });
    if (tab === 'pending') {
      if (!anySrc) return '<div class="card">' + ui.empty('Nothing to triage yet', 'Connect Google or Microsoft and discovery finds submissions in mail and drives. You can also add a submission directly.',
        '<div class="row row-wrap" style="justify-content:center">' + ui.button('Connect a source', { href: '#intake-sources', variant: 'default', size: 'sm', icon: 'plug' }) + ui.button('New submission', { href: '#intake-new', size: 'sm', icon: 'plus' }) + '</div>') + '</div>';
      return '<div class="card">' + ui.empty('Triage is clear', 'New arrivals from connected mail and drives show up here. Accepted items are in the Queue.', ui.button('Go to Queue', { href: '#queue', size: 'sm', iconRight: 'arrow-right' })) + '</div>';
    }
    var copy = { snoozed: ['Nothing snoozed', 'Snoozed items come back to Needs triage the next morning.'], declined: ['Nothing declined', 'Declined items stay here so you can restore them.'], processed: ['Nothing processed yet', 'Accepted, merged and split items are listed here with links to their assets.'] }[tab] || ['Nothing here', ''];
    return '<div class="card">' + ui.empty(copy[0], copy[1]) + '</div>';
  }

  function renderTriage() {
    var list = byTab(st.tab);
    ensureSel(list);
    var counts = tabCounts(pid());
    var html = '<div class="page">' + header('triage') + healthStrip(pid()) + flashHtml() +
      '<div class="toolbar">' + ui.tabs('ik-filter', [
        { id: 'pending', label: 'Needs triage', count: counts.pending },
        { id: 'snoozed', label: 'Snoozed', count: counts.snoozed },
        { id: 'declined', label: 'Declined', count: counts.declined },
        { id: 'processed', label: 'Processed', count: counts.processed }
      ], st.tab, 'intake-filter', { variant: 'pills', label: 'Triage status' }) + '<span class="spacer"></span>' + (st.tab === 'pending' ? kbdHint() : '') + '</div>';
    html += list.length ? '<div class="ik-list">' + list.map(function (it) { return itemHtml(it, it.id === st.sel); }).join('') + '</div>' : emptyFor(st.tab);
    return html + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Triage dialogs, menus, drawer                                       */
  /* ------------------------------------------------------------------ */
  function openSplit(it) {
    if (!actionable(it)) return;
    var cands = it.candidates || [];
    if (activeCands(it).length < 2) { A.toast(it.id + ' has only one creative. Use Accept instead.', 'info'); return; }
    var d = DRAFTS[it.id] || {};
    var f = it.inferred || {};
    var rows = cands.map(function (c, i) {
      var cd = d.candidates && d.candidates[i];
      if (c.excludedReason) {
        return '<tr class="is-muted"><td class="shrink"><label class="sr-only" for="ik-split-inc-' + i + '">Include ' + esc(c.name) + '</label><input type="checkbox" id="ik-split-inc-' + i + '" disabled></td>' +
          '<td><span class="row row-tight">' + icon(typeIcon(c.type)) + '<span>' + esc(c.name) + '</span></span><div class="xs muted">Excluded: ' + esc(c.excludedReason) + '</div></td><td colspan="2" class="small muted">Not an asset</td></tr>';
      }
      var prod = (cd && cd.product) || f.product || '', chan = (cd && cd.channel) || f.channel || '';
      return '<tr><td class="shrink"><label class="sr-only" for="ik-split-inc-' + i + '">Include ' + esc(c.name) + '</label><input type="checkbox" id="ik-split-inc-' + i + '" checked></td>' +
        '<td><span class="row row-tight">' + icon(typeIcon(c.type)) + '<span class="medium">' + esc(c.name) + '</span></span><div class="xs muted">' + esc((cd && cd.title) || c.name) + '</div></td>' +
        '<td><label class="sr-only" for="ik-split-prod-' + i + '">Product for ' + esc(c.name) + '</label>' + ui.select('ik-split-prod-' + i, [{ value: '', label: 'Choose…' }].concat(PRODUCTS), prod, { size: 'sm' }) + '</td>' +
        '<td><label class="sr-only" for="ik-split-chan-' + i + '">Channel for ' + esc(c.name) + '</label>' + ui.select('ik-split-chan-' + i, [{ value: '', label: 'Choose…' }].concat(CHANNELS), chan, { size: 'sm' }) + '</td></tr>';
    }).join('');
    var camps = [{ value: '', label: 'None' }].concat(campaignsFor(it.profileId).map(function (c) { return { value: c.id, label: c.name }; }));
    var n = activeCands(it).length;
    A.dialog({
      id: 'ik-split-dialog', title: 'Split ' + it.id + ' into ' + n + ' assets', size: 'lg',
      body: '<p class="small">One ' + (it.kind === 'sheet-row' ? 'sheet update' : 'message') + ' holds ' + n + ' separate creatives. Each becomes its own asset with its own preflight, review and history. Check the product and channel for each.</p>' +
        '<div class="table-wrap"><table class="table table-dense"><thead><tr><th class="shrink">Include</th><th>Creative</th><th>Product</th><th>Channel</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        selectField('Campaign', 'ik-split-camp', camps, campaignIn(it.profileId, d.campaignId) || '', { optional: true, hint: 'A label for grouping in the Queue. Leave as None if it doesn\'t belong to one.' }),
      actions: [{ label: 'Cancel', action: 'dialog-close' }, { label: 'Create assets', action: 'intake-split-confirm', variant: 'default', data: { id: it.id }, icon: 'split' }]
    });
  }

  function openNewVersion(it) {
    if (!actionable(it)) return;
    var text = itemText(it);
    var list = A.assetsFor(it.profileId).map(function (a) {
      var v = A.latestVersion(a);
      var o = a.id === it.newVersionOf && overlapFromReason(it) != null ? overlapFromReason(it) : overlap(text, a.title + ' ' + sectionsText(v ? v.content.sections : []));
      return { a: a, o: o, suggested: a.id === it.newVersionOf };
    }).sort(function (x, y) { return (y.suggested ? 1000 : y.o) - (x.suggested ? 1000 : x.o); }).slice(0, 6);
    if (!list.length) { A.toast('There are no assets in this profile yet.', 'info'); return; }
    var body = '<p class="small">Pick the asset this is a revision of. It becomes the next version; earlier versions stay exactly as they were, and the recheck labels each earlier finding as resolved or still present.</p>' +
      '<fieldset class="stack-sm" style="border:0;padding:0;margin:0"><legend class="sr-only">Asset</legend>' + list.map(function (x, i) {
        return '<label class="check ik-radio-row" for="ik-nv-' + esc(x.a.id) + '"><input type="radio" name="ik-nv-target" id="ik-nv-' + esc(x.a.id) + '" value="' + esc(x.a.id) + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span class="stack-sm" style="gap:2px"><span class="row row-wrap"><span class="mono medium">' + esc(x.a.id) + '</span><span>' + esc(x.a.title) + '</span></span>' +
          '<span class="row row-wrap small muted">' + ui.statusBadge(x.a.status) + '<span>' + x.o + '% text overlap</span>' + (x.suggested ? ui.tag('suggested') : '') + '<span>Next: V' + (maxN(x.a) + 1) + '</span></span></span></label>';
      }).join('') + '</fieldset>';
    A.dialog({
      id: 'ik-nv-dialog', title: 'New version of an existing asset', size: 'md', body: body,
      actions: [{ label: 'Cancel', action: 'dialog-close' }, { label: 'Add as new version', action: 'intake-newver-confirm', variant: 'default', data: { id: it.id }, icon: 'git-compare' }]
    });
  }

  function classifierLine(it) {
    var hitC = S().costLedger.find(function (c) { return !c.assetId && /^C-/.test(c.runId || '') && c.at === it.receivedAt; });
    if (hitC) {
      return hitC.cached ? 'Classifier ' + hitC.runId + ' · reused an earlier result (same file hash) · $0.00' :
        'AI classifier ' + hitC.runId + ' · ' + hitC.tokensIn.toLocaleString('en-US') + ' in / ' + hitC.tokensOut.toLocaleString('en-US') + ' out tokens · ' + ui.money(hitC.costUsd) + ' (sample)';
    }
    if (/rule-based/i.test(it.reason || '')) return 'Rule-based pre-check · no AI cost';
    return 'Rule-based pre-check, then AI only if unsure';
  }
  function openDetails(it) {
    if (!it) return;
    var s = A.sourceById(it.sourceId), prov = providerOf(it), snd = parseSender(it.sender);
    var conn = s && s.connectedBy ? A.userById(s.connectedBy) : null;
    var body = ui.dl([
      ['Item', '<span class="mono">' + esc(it.id) + '</span>'],
      ['Source', ui.sourceIcon(prov, { label: true }) + (s && s.account ? ' <span class="muted small">' + esc(s.account) + '</span>' : '')],
      ['Connected by', conn ? esc(conn.name) : '—'],
      ['From', esc(snd.name) + (snd.email && snd.email !== snd.name ? ' <span class="muted small">' + esc(snd.email) + '</span>' : '')],
      [it.kind === 'email' ? 'Received' : 'Modified', esc(ui.time(it.receivedAt))],
      ['Kind', esc(it.kind === 'email' ? 'Email' : it.kind === 'sheet-row' ? 'Sheet rows' : 'File')],
      ['Classification', classBadge(it.classification) + '<div class="small mt-4">' + esc(it.reason) + '</div>'],
      ['How it was classified', esc(classifierLine(it))],
      ['Status', esc(it.status) + (outcomeHtml(it) ? ' · ' + outcomeHtml(it) : '')]
    ]) +
      ((it.candidates || []).length ? '<div class="stack-sm"><span class="ik-label">Content found</span><ul class="ik-cands">' + it.candidates.map(function (c) {
        return '<li class="ik-cand' + (c.excludedReason ? ' is-excluded' : '') + '">' + icon(typeIcon(c.type)) + '<span class="ik-cand-name">' + esc(c.name) + '</span><span class="muted xs">' + esc(fmtSize(c.sizeKb)) + '</span>' +
          (c.excludedReason ? '<span class="xs muted">Excluded: ' + esc(c.excludedReason) + '</span>' : '') + '</li>';
      }).join('') + '</ul></div>' : '') +
      ui.callout('neutral', 'Treated as data', 'The original bytes are kept as received. Content from mail and files is never followed as instructions, and nothing is sent back to the sender.');
    A.drawer({ id: 'ik-details', title: it.id + ' · source details', body: body, width: 'md' });
  }

  /* ------------------------------------------------------------------ */
  /* Triage action registrations                                         */
  /* ------------------------------------------------------------------ */
  A.action('intake-tab', function (el) { A.go('#intake-' + ({ triage: 'triage', 'new': 'new', sources: 'sources' }[el.dataset.tab] || 'triage')); });
  A.action('intake-filter', function (el) { st.tab = el.dataset.tab || 'pending'; st.sel = null; A.rerender(); });
  A.action('intake-select', function (el) { st.sel = el.dataset.id; A.rerender(); });
  A.action('intake-confirm', function (el) { confirmItem(itemById(el.dataset.id)); });
  A.action('intake-focus-meta', function (el) { var it = itemById(el.dataset.id); if (it) focusMeta(it); });
  A.action('intake-meta', function (el) {
    var it = itemById(el.dataset.id);
    if (!actionable(it)) return;
    it.inferred = it.inferred || {};
    it.inferred[el.dataset.field] = el.value || null;
    it.inferred.confirmed = false;
    A.emit('data-changed', { kind: 'intake', id: it.id });
    st.sel = it.id;
    A.rerender();
  });
  A.action('intake-accept', function (el) { acceptItem(itemById(el.dataset.id)); });
  A.action('intake-accept-separate', function (el) { acceptItem(itemById(el.dataset.id), { separate: true }); });
  A.action('intake-decline-reason', function (el) { st.declineReason[el.dataset.id] = el.value; });
  A.action('intake-decline', function (el) { declineItem(itemById(el.dataset.id)); });
  A.action('intake-snooze', function (el) { snoozeItem(itemById(el.dataset.id)); });
  A.action('intake-unsnooze', function (el) {
    var it = itemById(el.dataset.id);
    if (!it || it.status !== 'snoozed') return;
    var prev = byTab(st.tab);
    it.status = 'pending'; it.snoozedUntil = null;
    A.toast(it.id + ' is back in Needs triage.');
    finishAction(prev, it, null);
  });
  A.action('intake-restore', function (el) {
    var it = itemById(el.dataset.id);
    if (!it || it.status !== 'declined') return;
    var prev = byTab(st.tab);
    it.status = 'pending'; it.declinedBy = null; it.declinedReason = null; it.declinedAt = null;
    A.logProfile(me().name, 'intake', 'Restored ' + it.id + ' to triage: ' + it.title);
    A.toast('Restored ' + it.id + ' to Needs triage.', 'success');
    finishAction(prev, it, null);
  });
  A.action('intake-merge', function (el) { mergeItem(itemById(el.dataset.id)); });
  A.action('intake-split', function (el) { openSplit(itemById(el.dataset.id)); });
  A.action('intake-split-confirm', function (el) {
    var it = itemById(el.dataset.id);
    if (!actionable(it)) { A.closeDialog(); return; }
    var chosen = [], missing = false;
    (it.candidates || []).forEach(function (c, i) {
      if (c.excludedReason) return;
      var inc = document.getElementById('ik-split-inc-' + i);
      if (inc && !inc.checked) return;
      var p = (document.getElementById('ik-split-prod-' + i) || {}).value, ch = (document.getElementById('ik-split-chan-' + i) || {}).value;
      if (!p || !ch) missing = true;
      chosen.push({ i: i, product: p, channel: ch });
    });
    if (!chosen.length) { A.toast('Select at least one creative.', 'warning'); return; }
    if (missing) { A.toast('Choose a product and a channel for each selected creative.', 'warning'); return; }
    var camp = (document.getElementById('ik-split-camp') || {}).value || null;
    A.closeDialog();
    var prev = byTab(st.tab);
    var ids = chosen.map(function (c) { return createFromIntake(it, { candidateIndex: c.i, product: c.product, channel: c.channel, campaignId: camp }).id; });
    var skipped = activeCands(it).length - chosen.length;
    it.status = 'split'; it.assetIds = ids; it.decidedBy = me().id; it.decidedAt = A.nowIso();
    it.inferred = it.inferred || {}; it.inferred.confirmed = true; it.inferred.confirmedBy = me().id;
    A.logProfile(me().name, 'intake', 'Split ' + it.id + ' into ' + ids.join(', ') + (skipped ? ' (' + skipped + ' left out)' : '') + '.');
    A.toast('Split ' + it.id + ' into ' + A.plural(ids.length, 'asset') + '. Preflight is running.', 'success');
    finishAction(prev, it, { variant: 'success', title: 'Split into ' + A.plural(ids.length, 'asset'), body: 'Created ' + ids.map(function (id) { return '<a class="mono" href="#asset-' + esc(id) + '">' + esc(id) + '</a>'; }).join(', ') +
      ' from ' + esc(it.id) + '. Each has its own preflight and review.' + ((it.candidates || []).some(function (c) { return c.excludedReason; }) ? ' The signature logo or empty row was left out.' : ''),
      links: [{ label: 'View in Queue', href: '#queue', icon: 'queue' }] });
    schedulePreflight(ids);
  });
  A.action('intake-newver', function (el) { openNewVersion(itemById(el.dataset.id)); });
  A.action('intake-newver-apply', function (el) { var it = itemById(el.dataset.id); if (it) applyNewVersion(it, el.dataset.assetId || it.newVersionOf); });
  A.action('intake-newver-confirm', function (el) {
    var it = itemById(el.dataset.id);
    var r = document.querySelector('input[name="ik-nv-target"]:checked');
    if (!it || !r) { A.toast('Pick an asset first.', 'warning'); return; }
    A.closeDialog();
    applyNewVersion(it, r.value);
  });
  A.action('intake-more', function (el) {
    var it = itemById(el.dataset.id);
    if (!it) return;
    var conf = isConfirmed(it);
    var items = [{ heading: it.id }];
    items.push({ label: 'New version of an existing asset…', icon: 'git-compare', action: 'intake-newver', data: { id: it.id }, kbd: 'N' });
    if (it.duplicateOf || it.newVersionOf) {
      items.push({ label: 'Accept as a separate asset', icon: 'plus', action: 'intake-accept-separate', data: { id: it.id }, disabled: !conf, hint: conf ? null : 'Product and channel come from the original' });
    }
    if (!it.duplicateOf && !it.newVersionOf && it.inferred && it.inferred.product && it.inferred.channel && !conf) {
      items.push({ label: 'Confirm product and channel', icon: 'check', action: 'intake-confirm', data: { id: it.id }, kbd: 'C' });
    }
    items.push({ sep: true });
    items.push({ label: 'Source details', icon: 'info', action: 'intake-details', data: { id: it.id } });
    A.menu(el, items, { align: 'end', label: 'More actions for ' + it.id, minWidth: 260 });
  });
  A.action('intake-details', function (el) { openDetails(itemById(el.dataset.id)); });
  A.action('intake-flash-close', function () { st.flash = null; A.rerender(); });
  A.action('intake-undo', function () {
    var f = st.flash;
    if (!f || !f.undo) return;
    var it = itemById(f.undo.id);
    st.flash = null;
    if (!it) { A.rerender(); return; }
    var wasDeclined = it.status === 'declined';
    it.status = f.undo.status || 'pending';
    if (wasDeclined) { it.declinedBy = null; it.declinedReason = null; it.declinedAt = null; A.logProfile(me().name, 'intake', 'Undid decline of ' + it.id + '.'); }
    else { it.snoozedUntil = null; }
    st.sel = it.id; st.focusId = 'ik-head-' + it.id;
    if (!TAB_FILTER[st.tab](it)) st.tab = it.status === 'snoozed' ? 'snoozed' : 'pending';
    A.emit('data-changed', { kind: 'intake', id: it.id });
    A.toast('Undone. ' + it.id + ' is back.', 'success');
    A.rerender();
  });

  function selected() {
    var list = byTab(st.tab);
    ensureSel(list);
    return st.sel ? itemById(st.sel) : null;
  }
  function needActionable(fn) {
    return function () {
      var it = selected();
      if (!it) { A.toast('Nothing selected.', 'info'); return; }
      if (!actionable(it)) { A.toast('Switch to Needs triage to act on items.', 'info'); return; }
      fn(it);
    };
  }
  function move(delta) {
    var list = byTab(st.tab);
    if (!list.length) return;
    ensureSel(list);
    var i = list.findIndex(function (x) { return x.id === st.sel; });
    var n = list[Math.max(0, Math.min(list.length - 1, i + delta))];
    st.sel = n.id; st.focusId = 'ik-head-' + n.id;
    A.rerender();
  }
  A.key('intake-triage', 'j', function () { move(1); }, 'Next item');
  A.key('intake-triage', 'k', function () { move(-1); }, 'Previous item');
  A.key('intake-triage', '1', needActionable(function (it) { acceptItem(it); }), 'Accept (or add as the suggested new version)');
  A.key('intake-triage', '2', needActionable(declineItem), 'Decline with the selected reason');
  A.key('intake-triage', '3', needActionable(mergeItem), 'Merge duplicate');
  A.key('intake-triage', 'h', needActionable(snoozeItem), 'Snooze until tomorrow 9 AM (H)');
  A.key('intake-triage', 's', needActionable(openSplit), 'Split into separate assets');
  A.key('intake-triage', 'n', needActionable(openNewVersion), 'New version of an existing asset');
  A.key('intake-triage', 'c', needActionable(confirmItem), 'Confirm inferred product and channel');

  /* ------------------------------------------------------------------ */
  /* New submission                                                      */
  /* ------------------------------------------------------------------ */
  function fileSupported(f) { return !f.unsupported && !f.real && SUPPORTED.indexOf(String(f.type || '').toLowerCase()) >= 0; }
  function importRows() {
    var map = st.imp.map, prof = A.profile();
    return CSV.rows.map(function (row, idx) {
      var m = {};
      CSV.columns.forEach(function (c, j) { var fld = map[c]; if (fld && fld !== 'ignore' && m[fld] == null) m[fld] = row[j]; });
      var errs = {};
      if (!String(m.body || '').trim()) errs.body = 'No copy in this row, so it will be skipped';
      var prod = normChoice(PRODUCTS, m.product), chan = normChoice(CHANNELS, m.channel);
      if (!prod) errs.product = m.product ? 'Unknown product "' + m.product + '"' : 'Product column not mapped';
      if (!chan) errs.channel = m.channel ? 'Unknown channel "' + m.channel + '"' : 'Channel column not mapped';
      var partner = (prof.partners || []).find(function (p) { return m.partner && p.name.toLowerCase() === String(m.partner).toLowerCase(); }) || null;
      return { n: idx + 1, m: m, product: prod, channel: chan, partner: partner, errs: errs, ok: !Object.keys(errs).length };
    });
  }
  function canRun() {
    if (st.run) return { ok: false, reason: 'Preflight is running.' };
    var needMeta = st.newTab === 'paste' && (!st.meta.product || !st.meta.channel);
    if (st.newTab === 'upload') {
      if (!st.files.length) return { ok: false, reason: 'Add at least one file.' };
      if (st.files.some(function (f) { return !f.product || !f.channel; })) return { ok: false, reason: 'Choose a product and a channel for each file.' };
      return { ok: true, text: 'Creates ' + A.plural(st.files.length, 'asset') + ' and runs preflight. About 3 seconds.' };
    }
    if (st.newTab === 'paste') {
      var p = st.paste;
      if (![p.headline, p.body, p.disclosures, p.cta].some(function (x) { return String(x || '').trim(); })) return { ok: false, reason: 'Paste some copy first.' };
      if (needMeta) return { ok: false, reason: 'Choose a product and a channel.' };
      return { ok: true, text: st.result && st.result.editing ? 'Saves V2 of ' + st.result.assetIds[0] + ' and rechecks it.' : 'Creates 1 asset and runs preflight. About 3 seconds.' };
    }
    if (!st.imp.loaded) return { ok: false, reason: 'Load a CSV or XLSX file.' };
    var ok = importRows().filter(function (r) { return r.ok; }).length;
    if (!ok) return { ok: false, reason: 'No valid rows to import. Check the column mapping.' };
    return { ok: true, text: 'Creates ' + A.plural(ok, 'asset') + ' from valid rows. Rows with errors are skipped.' };
  }
  function updateRunButton() {
    var b = document.getElementById('ik-run'), h = document.getElementById('ik-run-hint');
    var r = canRun();
    if (b) b.disabled = !r.ok;
    if (h) h.textContent = r.ok ? r.text : r.reason;
  }
  function parseStates(s) {
    return String(s || '').toUpperCase().split(/[^A-Z]+/).filter(function (x) { return /^[A-Z]{2}$/.test(x); })
      .filter(function (x, i, arr) { return arr.indexOf(x) === i; });
  }
  function uploadSourceId(profileId) { var s = S().sources.find(function (x) { return x.profileId === profileId && x.provider === 'upload'; }); return s ? s.id : null; }
  function batchSubmitter(profileId) {
    var p = st.meta.partnerId ? A.partnerById(st.meta.partnerId, profileId) : null;
    return p ? { submitter: { name: p.name, email: p.contactEmail, kind: 'partner' }, partnerId: p.id } : { submitter: { name: me().name, email: me().email, kind: 'member' }, partnerId: null };
  }
  function pasteSections() {
    var p = st.paste;
    return [sec('s1', 'Headline', p.headline), sec('s2', 'Body', p.body), sec('s3', 'Disclosures', p.disclosures), sec('s4', 'Call to action', p.cta)];
  }
  function buildSpecs(profileId) {
    var common = {
      profileId: profileId, states: parseStates(st.meta.states), campaignId: st.meta.campaignId || null, dueDate: st.meta.dueDate || defaultDue(),
      audience: st.meta.audience || '', origin: 'upload', authorName: me().name, actorName: me().name
    };
    var who = batchSubmitter(profileId);
    var srcId = uploadSourceId(profileId);
    function mk(o) { return Object.assign({}, common, { submitter: who.submitter, partnerId: who.partnerId }, o); }
    if (st.newTab === 'upload') {
      return st.files.map(function (f) {
        var d = f.draft || { title: f.name, format: typeIcon(f.type) === 'image' ? 'image' : (f.type === 'pdf' ? 'pdf' : 'text'), sections: [sec('s1', 'File', f.name + ' (' + fmtSize(f.sizeKb) + '). Contents are not read in this prototype.')] };
        var unsupported = f.unsupported || (f.real ? 'Prototype: file contents are not read' : (!fileSupported(f) ? String(f.type || 'This file type').toUpperCase() + ': stored, not reviewed by AI' : null));
        return mk({ title: d.title || f.name, product: f.product, channel: f.channel, format: d.format, subject: d.subject, sections: d.sections, visual: d.visual, unsupported: unsupported,
          sourceRefs: [{ sourceId: srcId, label: 'Upload: ' + f.name + ' by ' + me().name, seenAt: A.nowIso() }],
          intakeText: 'Uploaded ' + f.name + ' (' + fmtSize(f.sizeKb) + ') in New submission. Product ' + productLabel(f.product) + ', channel ' + channelLabel(f.channel) + '.' });
      });
    }
    if (st.newTab === 'paste') {
      var p = st.paste;
      var secs = pasteSections().filter(function (s) { return String(s.text || '').trim(); });
      var base = (p.headline || p.body || p.cta || '').replace(/^ClearPath:\s*/, '').split(/[.!?]/)[0].trim().slice(0, 56);
      return [mk({ title: '"' + base + '" ' + channelLabel(st.meta.channel), product: st.meta.product, channel: st.meta.channel, format: 'text', sections: secs,
        sourceRefs: [{ sourceId: srcId, label: 'Paste: copy pasted by ' + me().name, seenAt: A.nowIso() }],
        intakeText: 'Pasted copy in New submission. Product ' + productLabel(st.meta.product) + ', channel ' + channelLabel(st.meta.channel) + '.' })];
    }
    return importRows().filter(function (r) { return r.ok; }).map(function (r) {
      var m = r.m;
      var secs = [sec('s1', 'Headline', m.headline), sec('s2', 'Body', m.body), sec('s3', 'Disclosures', m.disclosures), sec('s4', 'Call to action', m.cta)].filter(function (s) { return String(s.text || '').trim(); });
      var o = mk({ title: (m.headline || m.body).slice(0, 60) + ' (' + channelLabel(r.channel) + ')', product: r.product, channel: r.channel, format: 'text', sections: secs,
        sourceRefs: [{ sourceId: srcId, label: 'Import: ' + CSV.name + ' row ' + r.n + ' by ' + me().name, seenAt: A.nowIso() }],
        intakeText: 'Imported from ' + CSV.name + ', row ' + r.n + ', in New submission.' });
      if (r.partner) { o.partnerId = r.partner.id; o.submitter = { name: r.partner.name, email: r.partner.contactEmail, kind: 'partner' }; }
      return o;
    });
  }
  function startRun() {
    var r = canRun();
    if (!r.ok) { A.toast(r.reason, 'warning'); return; }
    var profileId = pid();
    var editing = st.result && st.result.editing ? st.result.assetIds[0] : null;
    var specs = buildSpecs(profileId);
    var token = A.uid('run');
    st.run = { token: token, stage: 0, specs: specs, profileId: profileId, editing: editing, source: st.newTab };
    st.result = null;
    A.rerender();
    var tick = function () {
      later(function () {
        if (!st.run || st.run.token !== token) return;
        st.run.stage += 1;
        if (st.run.stage >= PRE_STEPS.length) finishRun(); else { if (A.current().name === 'intake-new') A.rerender(); tick(); }
      }, 625);
    };
    tick();
  }
  function finishRun() {
    var run = st.run;
    if (!run) return;
    var ids = [], editedVersion = null;
    if (run.editing && A.asset(run.editing, { anyProfile: true })) {
      var a = A.asset(run.editing, { anyProfile: true });
      var nv = A.newVersion(a.id, { origin: 'upload', sections: pasteSections(), authorName: me().name });
      if (nv) {
        nv.content.sections = nv.content.sections.filter(function (s) { return String(s.text || '').trim(); });
        addNewFindings(a, nv);
        patchVersionEvent(a, nv);
        A.emit('data-changed', { kind: 'version', assetId: a.id });
        ids.push(a.id);
        editedVersion = nv.id;
      }
    } else {
      run.specs.forEach(function (sp) {
        var a2 = newAsset(sp);
        completePreflight(a2.id);
        ids.push(a2.id);
      });
    }
    st.run = null;
    st.result = { assetIds: ids, source: run.source, editing: false, versionId: editedVersion };
    if (run.source === 'upload') st.files = [];
    var total = { critical: 0, major: 0, minor: 0 };
    ids.forEach(function (id) {
      var x = A.asset(id, { anyProfile: true }), v = x && A.latestVersion(x), c = sevCounts(v ? v.findings : []);
      total.critical += c.critical; total.major += c.major; total.minor += c.minor;
    });
    A.toast(editedVersion ? 'Saved ' + ids[0] + ' V' + (A.version(A.asset(ids[0], { anyProfile: true }), editedVersion) || {}).n + ' and rechecked it.' :
      'Preflight finished: ' + A.plural(ids.length, 'asset') + ' created, ' + countsText(total) + '.', total.critical ? 'warning' : 'success');
    rr();
  }

  function inputCard() {
    var editing = st.result && st.result.editing;
    var panel;
    if (st.newTab === 'upload') panel = uploadPanel();
    else if (st.newTab === 'paste') panel = pastePanel();
    else panel = importPanel();
    return '<section class="card" aria-labelledby="ik-add-title"><div class="card-header with-border"><div><h2 class="card-title" id="ik-add-title">' + (editing ? 'Edit copy' : 'Add creative') + '</h2>' +
      '<p class="card-desc">' + (editing ? 'Change the copy and run preflight again. This saves a new version.' : 'Upload files, paste copy, or import a sheet of creatives. Each item becomes its own asset.') + '</p></div></div>' +
      '<div class="card-body stack">' +
      (editing ? ui.callout('info', 'Editing ' + st.result.assetIds[0], 'Running preflight saves the next version of ' + esc(st.result.assetIds[0]) + '. Earlier versions stay exactly as they were.', { actionsHtml: btn('Stop editing', 'intake-run-cancel-edit', { variant: 'ghost' }) }) :
        ui.tabs('ik-new-tabs', [{ id: 'upload', label: 'Upload files', icon: 'upload' }, { id: 'paste', label: 'Paste copy', icon: 'clipboard' }, { id: 'import', label: 'Import CSV/XLSX', icon: 'sheet' }], st.newTab, 'intake-new-tab', { variant: 'pills', label: 'Submission type' })) +
      '<div class="tab-panel stack" role="tabpanel" aria-labelledby="ik-new-tabs-tab-' + esc(st.newTab) + '">' + panel + '</div></div></section>';
  }
  function uploadPanel() {
    var next = SAMPLE_FILES[st.sampleIdx % SAMPLE_FILES.length];
    var html = '<button type="button" class="dropzone ik-drop" id="ik-dropzone" data-action="intake-add-file" aria-describedby="ik-types">' + icon('upload') +
      '<span class="strong">Drop files here, or click to add a sample file</span>' +
      '<span class="small">Next sample: ' + esc(next.name) + '</span></button>' +
      '<p class="hint" id="ik-types">Reviewed by AI: text, PNG/JPG, PDF, HTML, .eml. Anything else is stored as received, not reviewed by AI, and goes to Needs manual review. Dropped files are listed by name only; this prototype does not read them.</p>';
    if (!st.files.length) return html;
    return html + ui.table([
      { key: 'name', label: 'File', render: function (f) { return '<span class="row row-tight">' + icon(typeIcon(f.type)) + '<span class="medium wrap-anywhere">' + esc(f.name) + '</span></span>'; } },
      { key: 'type', label: 'Type', shrink: true, render: function (f) { return '<span class="mono small">' + esc(String(f.type || '').toUpperCase()) + '</span>'; } },
      { key: 'size', label: 'Size', align: 'right', shrink: true, render: function (f) { return esc(fmtSize(f.sizeKb)); } },
      { key: 'product', label: 'Product', render: function (f, i) {
        return '<label class="sr-only" for="ik-file-prod-' + i + '">Product for ' + esc(f.name) + '</label>' +
          ui.select('ik-file-prod-' + i, [{ value: '', label: 'Choose…' }].concat(PRODUCTS), f.product || '', { change: 'intake-file-meta', data: { index: i, field: 'product' }, size: 'sm' });
      } },
      { key: 'channel', label: 'Channel', render: function (f, i) {
        return '<label class="sr-only" for="ik-file-chan-' + i + '">Channel for ' + esc(f.name) + '</label>' +
          ui.select('ik-file-chan-' + i, [{ value: '', label: 'Choose…' }].concat(CHANNELS), f.channel || '', { change: 'intake-file-meta', data: { index: i, field: 'channel' }, size: 'sm' });
      } },
      { key: 'review', label: 'Review', shrink: true, render: function (f) { return fileSupported(f) ? '<span class="row row-tight small">' + icon('sparkles') + '<span>AI preflight</span></span>' : '<span class="badge badge-outline">' + icon('hand') + '<span>Manual review</span></span>'; } },
      { key: 'x', label: 'Remove', srOnly: true, shrink: true, render: function (f, i) { return btn('Remove ' + f.name, 'intake-remove-file', { data: { index: i }, variant: 'ghost', icon: 'x', iconOnly: true }); } }
    ], st.files, { dense: true, caption: 'Files in this batch' });
  }
  function pastePanel() {
    var p = st.paste;
    function inp(field, label, opt) {
      var id = 'ik-paste-' + field;
      return ui.field(label, '<input class="input" id="' + id + '" type="text" value="' + esc(p[field]) + '" data-input="intake-paste" data-field="' + field + '" autocomplete="off">', { id: id, optional: opt });
    }
    function ta(field, label, rows, opt, hint) {
      var id = 'ik-paste-' + field;
      return ui.field(label, '<textarea class="textarea" id="' + id + '" rows="' + rows + '" data-input="intake-paste" data-field="' + field + '">' + esc(p[field]) + '</textarea>', { id: id, optional: opt, hint: hint });
    }
    var editing = st.result && st.result.editing;
    return '<div class="row row-wrap between"><span class="small muted">Separate fields help preflight point at the exact line that needs a fix.</span>' +
      (editing ? '' : '<span class="row">' + btn('Load example SMS', 'intake-paste-example', { variant: 'ghost', icon: 'message' }) + btn('Clear', 'intake-paste-clear', { variant: 'ghost', icon: 'x' }) + '</span>') + '</div>' +
      inp('headline', 'Headline', true) + ta('body', 'Body copy', 4, false, 'For SMS, paste the whole message here.') + ta('disclosures', 'Disclosures', 2, true) + inp('cta', 'Call to action', true);
  }
  function importPanel() {
    if (!st.imp.loaded) {
      return '<button type="button" class="dropzone ik-drop" id="ik-import-drop" data-action="intake-import-load">' + icon('sheet') +
        '<span class="strong">Choose a CSV or XLSX file</span><span class="small">Click to load the sample ' + esc(CSV.name) + ' (3 rows from LoanFinder Deals)</span></button>' +
        '<p class="hint">One row per creative. Map your columns once; the mapping applies to every row.</p>';
    }
    var rows = importRows();
    var okN = rows.filter(function (r) { return r.ok; }).length;
    var mapHtml = '<div class="ik-map">' + CSV.columns.map(function (c) {
      return selectField(c, 'ik-map-' + c, MAP_FIELDS, st.imp.map[c] || 'ignore', { change: 'intake-import-map', data: { col: c }, size: 'sm' });
    }).join('') + '</div>';
    function cell(field) {
      return function (r) {
        var v = r.m[field];
        var shown = field === 'product' ? (r.product ? productLabel(r.product) : v) : field === 'channel' ? (r.channel ? channelLabel(r.channel) : v) : v;
        if (r.errs[field]) return '<span class="ik-cell-err" title="' + esc(r.errs[field]) + '">' + (shown ? esc(shown) : '(empty)') + '</span>';
        return shown ? '<span class="clamp-2">' + esc(shown) + '</span>' : '<span class="muted">—</span>';
      };
    }
    var table = ui.table([
      { key: 'n', label: 'Row', shrink: true, render: function (r) { return '<span class="mono">' + r.n + '</span>'; } },
      { key: 'headline', label: 'Headline', render: cell('headline') },
      { key: 'body', label: 'Body copy', render: cell('body') },
      { key: 'disclosures', label: 'Disclosures', render: cell('disclosures') },
      { key: 'cta', label: 'CTA', render: cell('cta') },
      { key: 'product', label: 'Product', render: cell('product') },
      { key: 'channel', label: 'Channel', render: cell('channel') },
      { key: 'partner', label: 'Partner', render: function (r) { return r.partner ? esc(r.partner.name) : (r.m.partner ? '<span class="muted">' + esc(r.m.partner) + ' (not a partner)</span>' : '<span class="muted">—</span>'); } },
      { key: 'st', label: 'Status', render: function (r) {
        return r.ok ? '<span class="row row-tight small success-text">' + icon('circle-check') + '<span>Ready</span></span>' :
          '<span class="row row-tight small danger-text">' + icon('alert') + '<span>' + esc(Object.keys(r.errs).map(function (k) { return r.errs[k]; }).join('; ')) + '</span></span>';
      } }
    ], rows, { dense: true, caption: 'Import preview', rowAttrs: function (r) { return r.ok ? null : { 'class': 'is-muted' }; } });
    return '<div class="row row-wrap between"><span class="row row-tight">' + icon('sheet') + '<span class="medium">' + esc(CSV.name) + '</span><span class="muted small">' + fmtSize(CSV.sizeKb) + ' · ' + CSV.rows.length + ' rows</span></span>' +
      btn('Remove file', 'intake-import-clear', { variant: 'ghost', icon: 'x' }) + '</div>' +
      '<div class="stack-sm"><span class="ik-label">Column mapping</span>' + mapHtml + '</div>' +
      '<div class="stack-sm"><span class="ik-label">Preview · ' + okN + ' of ' + rows.length + ' rows ready</span>' + table + '</div>';
  }
  function metaPanel() {
    var p = A.profile();
    var locked = !!st.run || !!(st.result && !st.result.editing);
    var imp = st.newTab === 'import';
    var editing = st.result && st.result.editing;
    var camps = [{ value: '', label: 'None' }].concat(campaignsFor(p.id).map(function (c) { return { value: c.id, label: c.name }; }));
    var partners = [{ value: '', label: 'None (internal)' }].concat((p.partners || []).map(function (x) { return { value: x.id, label: x.name + ' (' + x.type + ')' }; }));
    var dis = locked || editing;
    var r = canRun();
    var runLabel = editing ? 'Run preflight and save V2' : 'Run preflight';
    return '<aside class="card" aria-labelledby="ik-meta-title"><div class="card-header with-border"><div><h2 class="card-title" id="ik-meta-title">Details</h2>' +
      '<p class="card-desc">' + (editing ? 'Details stay as they are on the asset.' : 'Applies to every item in this batch.') + '</p></div></div>' +
      '<div class="card-body stack">' +
      (imp || st.newTab === 'upload' ? '<p class="small muted row row-tight">' + icon('info') + '<span>' + (imp ? 'Product and channel come from each row of the file.' : 'Product and channel are set per file in the list.') + '</span></p>' :
        selectField('Product', 'ik-meta-product', [{ value: '', label: 'Choose…' }].concat(PRODUCTS), st.meta.product, { change: 'intake-new-meta', data: { field: 'product' }, disabled: dis }) +
        selectField('Channel', 'ik-meta-channel', [{ value: '', label: 'Choose…' }].concat(CHANNELS), st.meta.channel, { change: 'intake-new-meta', data: { field: 'channel' }, disabled: dis })) +
      ui.field('States', '<input class="input" id="ik-meta-states" type="text" placeholder="e.g. TX, AZ" value="' + esc(st.meta.states) + '" data-input="intake-new-meta" data-field="states" autocomplete="off"' + (dis ? ' disabled' : '') + '>',
        { id: 'ik-meta-states', optional: true, hint: 'Leave empty for nationwide. State-specific rules are not covered yet.' }) +
      selectField('Campaign', 'ik-meta-campaign', camps, st.meta.campaignId, { change: 'intake-new-meta', data: { field: 'campaignId' }, optional: true, disabled: dis }) +
      selectField('Partner', 'ik-meta-partner', partners, st.meta.partnerId, { change: 'intake-new-meta', data: { field: 'partnerId' }, optional: true, disabled: dis, hint: 'The agency or affiliate that made it, if any.' }) +
      ui.field('Due date', '<input class="input" id="ik-meta-due" type="date" value="' + esc(st.meta.dueDate) + '" data-change="intake-new-meta" data-field="dueDate"' + (dis ? ' disabled' : '') + '>', { id: 'ik-meta-due' }) +
      ui.field('Audience', '<textarea class="textarea" id="ik-meta-audience" rows="2" placeholder="Who receives it and how they were chosen" data-input="intake-new-meta" data-field="audience"' + (dis ? ' disabled' : '') + '>' + esc(st.meta.audience) + '</textarea>',
        { id: 'ik-meta-audience', optional: true, hint: 'Needed for direct mail, SMS and prescreened offers. If it\'s empty there, preflight flags it as missing information.' }) +
      '</div><div class="card-footer"><div class="stack" style="width:100%">' +
      ui.button(runLabel, { action: 'intake-run', variant: 'default', block: true, icon: 'sparkles', id: 'ik-run', disabled: !r.ok || locked, kbd: (A.labels && /Mac/.test(navigator.platform || '') ? '⌘↵' : 'Ctrl+Enter') }) +
      '<p class="hint" id="ik-run-hint" aria-live="polite">' + esc(locked ? (st.run ? 'Preflight is running.' : 'Start a new submission to add more.') : (r.ok ? r.text : r.reason)) + '</p>' +
      ui.aiChip() + '</div></div></aside>';
  }
  function runCard() {
    var run = st.run;
    return '<section class="card" aria-live="polite" aria-labelledby="ik-run-title"><div class="card-header with-border"><div><h2 class="card-title" id="ik-run-title">' + icon('loader', { cls: 'spin' }) +
      '<span>' + (run.editing ? 'Rechecking ' + esc(run.editing) : 'Running preflight') + '</span></h2><p class="card-desc">' + (run.editing ? 'Saving the next version and rechecking earlier findings.' : A.plural(run.specs.length, 'item') + ' · about 3 seconds') + '</p></div></div>' +
      '<div class="card-body stack">' + ui.steps(PRE_STEPS, run.stage) + ui.meter(run.stage, PRE_STEPS.length, { label: 'Preflight progress', auto: false }) +
      (run.editing ? '' : '<ul class="ik-cands">' + run.specs.map(function (sp) { return '<li class="ik-cand">' + icon('file') + '<span>' + esc(sp.title) + '</span>' + (sp.unsupported ? '<span class="xs muted">' + esc(sp.unsupported) + '</span>' : '') + '</li>'; }).join('') + '</ul>') +
      '</div></section>';
  }
  function resultCard() {
    var r = st.result;
    var assets = r.assetIds.map(function (id) { return A.asset(id); }).filter(Boolean);
    if (!assets.length) { st.result = null; return inputCard(); }
    var total = { critical: 0, major: 0, minor: 0 };
    var rows = assets.map(function (a) {
      var v = A.latestVersion(a), c = sevCounts(v.findings);
      total.critical += c.critical; total.major += c.major; total.minor += c.minor;
      var alerts = (v.securityAlerts || []).length;
      var rc = r.versionId ? recheckCounts(v) : null;
      return '<tr><td class="shrink"><a class="mono medium" href="#asset-' + esc(a.id) + '">' + esc(a.id) + '</a></td>' +
        '<td><span class="cell-title">' + esc(a.title) + '</span><span class="cell-sub">' + esc(productLabel(a.product) + ' · ' + channelLabel(a.channel)) + ' · V' + v.n + ' · ' + ui.sha(v.sha) + '</span></td>' +
        '<td>' + ui.statusBadge(a.status, a.subLabel) + '</td>' +
        '<td>' + sevSummaryHtml(c) + (alerts ? '<div class="xs warning-text mt-4">' + A.plural(alerts, 'injection warning') + '</div>' : '') +
        (rc ? '<div class="xs muted mt-4">' + rc.resolved + ' resolved · ' + rc.still + ' still present · ' + rc.fresh + ' new</div>' : '') + '</td>' +
        '<td class="shrink num small">' + esc(v.run && v.run.status === 'complete' ? ui.money(v.run.costUsd) : (v.run && v.run.status === 'failed' ? 'declined' : '—')) + '</td></tr>';
    }).join('');
    var one = assets.length === 1 ? assets[0] : null;
    var head = r.versionId ? 'Saved V' + A.latestVersion(one || assets[0]).n + ' and rechecked it' : 'Preflight finished';
    var desc = r.versionId ? 'The earlier version is unchanged. Compare them side by side.' : (assets.length === 1 ? one.id + ' is in the review queue now.' : A.plural(assets.length, 'asset') + ' are in the review queue now.');
    var warn = (total.critical || total.major) && !r.versionId ? ui.callout('warning', countsText(total) + (assets.length > 1 ? ' across this batch' : ' on ' + one.id),
      'Fix the copy now and run preflight again, or leave it for the reviewer. Either way a person decides; preflight is advisory.') : '';
    var acts = [];
    if (one) acts.push(ui.button('Open ' + one.id, { href: '#asset-' + one.id, variant: 'default', size: 'sm', iconRight: 'arrow-right' }));
    if (r.versionId && one) acts.push(ui.button('Compare versions', { href: '#compare-' + one.id, size: 'sm', icon: 'git-compare' }));
    if (r.source === 'paste' && one && !r.versionId) acts.push(btn('Edit copy and re-run', 'intake-run-edit', { icon: 'edit' }));
    acts.push(ui.button('Go to Queue', { href: '#queue', size: 'sm', icon: 'queue' }));
    acts.push(btn('New submission', 'intake-run-reset', { variant: 'ghost', icon: 'plus' }));
    return '<section class="card" aria-labelledby="ik-res-title"><div class="card-header with-border"><div><h2 class="card-title" id="ik-res-title">' + icon('circle-check') + '<span>' + esc(head) + '</span></h2>' +
      '<p class="card-desc">' + esc(desc) + '</p></div>' + ui.aiChip() + '</div>' +
      '<div class="card-body stack">' + warn +
      '<div class="table-wrap"><table class="table table-dense"><caption class="sr-only">Preflight results</caption><thead><tr><th>ID</th><th>Asset</th><th>Status</th><th>Findings</th><th class="num">AI cost</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="xs muted">AI cost is a sample figure for the prototype. Unsupported files skip the AI run and cost $0.00.</p></div>' +
      '<div class="card-footer">' + acts.join('') + '</div></section>';
  }
  function renderNew() {
    var main;
    if (st.run) main = runCard();
    else if (st.result && !st.result.editing) main = resultCard();
    else main = inputCard();
    return '<div class="page">' + header('new') + '<div class="ik-new"><div class="stack-lg">' + main + '</div>' + metaPanel() + '</div></div>';
  }

  A.action('intake-goto-new', function (el) { st.newTab = el.dataset.tab || 'upload'; if (!st.run && !(st.result && st.result.editing)) st.result = null; A.go('#intake-new'); });
  A.action('intake-new-tab', function (el) { st.newTab = el.dataset.tab || 'upload'; A.rerender(); });
  A.action('intake-add-file', function () {
    if (st.run) return;
    var f = SAMPLE_FILES[st.sampleIdx % SAMPLE_FILES.length];
    st.sampleIdx += 1;
    st.files.push(A.clone(f));
    A.toast('Added ' + f.name + (f.product ? '. Product and channel were inferred from the file; check them in the list.' : '.'), 'info');
    A.rerender();
  });
  A.action('intake-remove-file', function (el) { st.files.splice(parseInt(el.dataset.index, 10), 1); A.rerender(); });
  A.action('intake-file-meta', function (el) {
    var f = st.files[parseInt(el.dataset.index, 10)];
    if (!f) return;
    f[el.dataset.field] = el.value || null;
    A.rerender();
  });
  A.action('intake-paste', function (el) { st.paste[el.dataset.field] = el.value; updateRunButton(); });
  A.action('intake-paste-example', function () {
    st.paste = A.clone(PASTE_EXAMPLE);
    st.meta.product = 'personal_loan'; st.meta.channel = 'sms';
    A.toast('Example SMS loaded. Product and channel set to Personal loan · SMS.', 'info');
    A.rerender();
  });
  A.action('intake-paste-clear', function () { st.paste = { headline: '', body: '', disclosures: '', cta: '' }; A.rerender(); });
  A.action('intake-import-load', function () { st.imp.loaded = true; A.toast('Loaded ' + CSV.name + ': 3 rows. Check the column mapping.', 'info'); A.rerender(); });
  A.action('intake-import-clear', function () { st.imp = { loaded: false, map: A.clone(DEFAULT_MAP) }; A.rerender(); });
  A.action('intake-import-map', function (el) { st.imp.map[el.dataset.col] = el.value; A.rerender(); });
  A.action('intake-new-meta', function (el) {
    st.meta[el.dataset.field] = el.value;
    if (el.tagName === 'SELECT') A.rerender(); else updateRunButton();
  });
  A.action('intake-run', function () { startRun(); });
  A.action('intake-run-reset', function () {
    st.result = null; st.files = [];
    st.paste = { headline: '', body: '', disclosures: '', cta: '' };
    st.imp = { loaded: false, map: A.clone(DEFAULT_MAP) };
    A.rerender();
  });
  A.action('intake-run-edit', function () {
    if (!st.result) return;
    var a = A.asset(st.result.assetIds[0]);
    if (!a) return;
    st.result.editing = true; st.newTab = 'paste';
    st.focusId = 'ik-paste-body';
    A.rerender();
  });
  A.action('intake-run-cancel-edit', function () { if (st.result) st.result.editing = false; A.rerender(); });
  A.key('intake-new', 'mod+enter', function () { startRun(); }, { label: 'Run preflight', allowInInputs: true });

  /* ------------------------------------------------------------------ */
  /* Sources                                                             */
  /* ------------------------------------------------------------------ */
  function sourcesFor(profileId, gid) { return S().sources.filter(function (s) { return s.profileId === profileId && s.group === gid; }); }
  function groupStatus(list) {
    var sts = list.map(effStatus);
    var order = ['syncing', 'resyncing-gap', 'owner-removed', 'needs-reconnect', 'error', 'connected'];
    for (var i = 0; i < order.length; i++) if (sts.indexOf(order[i]) >= 0) return order[i];
    return 'not-connected';
  }
  function latestOf(list, key) {
    return list.reduce(function (best, s) { return s[key] && (!best || A.toMs(s[key]) > A.toMs(best)) ? s[key] : best; }, null);
  }

  function provCard(gid) {
    var g = GROUPS[gid], p = A.profile();
    var list = sourcesFor(p.id, gid);
    var bySvc = {};
    list.forEach(function (s) { bySvc[s.provider] = s; });
    var gs = groupStatus(list);
    var live = gs === 'connected' || gs === 'syncing' || gs === 'resyncing-gap' || gs === 'error';
    var acct = list.find(function (s) { return s.account && effStatus(s) !== 'not-connected'; });
    var parts = [];

    if (gs === 'needs-reconnect') {
      var errS = list.find(function (s) { return effStatus(s) === 'needs-reconnect'; });
      var errE = (errS.syncLog || []).find(function (e) { return e.kind === 'error'; });
      parts.push(ui.callout('warning', 'Reconnect needed', esc(errE ? errE.summary.split('. ')[0] + '.' : g.name + ' rejected the saved sign-in.') +
        ' <strong>What\'s preserved:</strong> every item already imported, with its versions, findings and decisions. After you reconnect, sync resumes from the last checkpoint (' +
        esc(ui.time(errS.lastSyncAt)) + '), so nothing is imported twice.'));
    } else if (gs === 'owner-removed') {
      var or = list.find(function (s) { return effStatus(s) === 'owner-removed'; });
      var ou = A.userById(or.connectedBy);
      parts.push(ui.callout('warning', 'Connection owner removed', esc((ou ? ou.name : 'The member who connected this account') + ' is no longer a member of this profile, so this connection stopped syncing. Imported items and their history stay. Reconnect with your own account to resume.')));
    } else if (gs === 'resyncing-gap') {
      var gp = st.gap[gid] || { done: 0, total: 7 };
      parts.push(ui.callout('recheck', 'Resyncing after gap', 'Gmail\'s change history expired, so we\'re rescanning the last 7 days. Items already imported are matched, not duplicated.' +
        '<div class="meter-row mt-8">' + ui.meter(gp.done, gp.total, { label: 'Rescan progress', auto: false }) + '<span class="num">' + gp.done + ' of ' + gp.total + ' days</span></div>'));
    } else if (gs === 'syncing') {
      var first = list.some(function (s) { return effStatus(s) === 'syncing' && !(s.syncLog || []).some(function (e) { return e.kind !== 'connection'; }); });
      parts.push(ui.callout('info', first ? 'First sync' : 'Syncing', first ? 'Discovery finished. Pulling the items it found into Triage.' : 'Checking for new mail and changed files since the last sync.'));
    }

    if (live || gs === 'needs-reconnect' || gs === 'owner-removed') {
      var conn = acct && acct.connectedBy ? A.userById(acct.connectedBy) : null;
      var watch = acct && acct.watch === 'narrowed';
      parts.push(ui.dl([
        ['Account', acct ? '<span class="wrap-anywhere">' + esc(acct.account) + '</span>' : '—'],
        ['Connected by', conn ? '<span class="row row-tight">' + ui.avatar(conn, { size: 'sm' }) + '<span>' + esc(conn.name) + '</span></span>' : '—'],
        ['What we watch', '<span>' + esc(acct ? (acct.watchDetail || SMART[gid]) : SMART[gid]) + '</span><div class="mt-4">' +
          ui.button(watch ? 'Change or go back to Smart watch' : 'Narrow to labels or folders', { action: 'src-narrow', data: { group: gid }, variant: 'link', size: 'sm', disabled: !live }) + (watch ? '' : ' <span class="xs muted">optional</span>') + '</div>'],
        ['Access', 'Read-only, through Nango. Never sends, edits or deletes.'],
        ['Last sync', esc(latestOf(list, 'lastSyncAt') ? ui.relTime(latestOf(list, 'lastSyncAt')) : '—')],
        ['Items found', '<span class="num">' + list.reduce(function (n, s) { return n + (s.itemsFound || 0); }, 0) + '</span>']
      ]));
    } else {
      parts.push('<p class="small">One click connects ' + esc(g.blurb) + ' with read-only access. Discovery starts as soon as you allow access.</p>');
    }

    parts.push('<ul class="ik-svc" aria-label="' + esc(g.name) + ' services">' + g.services.map(function (svc) {
      var s = bySvc[svc], stt = effStatus(s);
      var meta = [];
      if (s && stt !== 'not-connected' && s.lastSyncAt) meta.push('<span title="' + esc(ui.time(s.lastSyncAt)) + '">' + esc(ui.relTime(s.lastSyncAt)) + '</span>');
      if (s && stt !== 'not-connected') meta.push('<span>' + A.plural(s.itemsFound || 0, 'item') + '</span>');
      if (stt === 'not-connected' && s && s.watchDetail && s.watch == null) meta.push('<span>' + esc(s.watchDetail) + '</span>');
      return '<li>' + ui.sourceIcon(svc, { label: true }) + ((s && s.illustrative) || g.illustrative ? ui.illustrative() : '') +
        '<span class="ik-svc-meta">' + statusPill(stt) + meta.join('<span aria-hidden="true">·</span>') + '</span></li>';
    }).join('') + '</ul>');

    var foot = [];
    var hasLog = list.some(function (s) { return (s.syncLog || []).length; });
    if (gs === 'not-connected') foot.push(btn('Connect ' + g.name, 'src-connect', { data: { group: gid }, variant: 'default', icon: 'plug', size: 'md' }));
    else if (gs === 'needs-reconnect' || gs === 'owner-removed') foot.push(btn('Reconnect ' + g.name, 'src-connect', { data: { group: gid }, variant: 'default', icon: 'refresh', size: 'md' }));
    else {
      var busy = gs === 'syncing' || gs === 'resyncing-gap';
      foot.push(ui.button(busy ? 'Syncing…' : 'Sync now', { action: 'src-sync', data: { group: gid }, size: 'sm', disabled: busy, labelHtml: busy ? icon('loader', { cls: 'spin' }) + '<span>Syncing…</span>' : null, icon: busy ? null : 'refresh' }));
    }
    if (hasLog) foot.push(btn('View sync log', 'src-log', { data: { group: gid }, variant: 'ghost', icon: 'history' }));
    if (gs !== 'not-connected') foot.push(btn('More options for ' + g.name, 'src-more', { data: { group: gid }, variant: 'ghost', icon: 'more', iconOnly: true, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }));

    return '<section class="card" aria-labelledby="ik-prov-' + gid + '"><div class="card-header with-border"><div class="row">' +
      '<span class="ik-mono" aria-hidden="true">' + esc(g.mono) + '</span><div><h2 class="card-title" id="ik-prov-' + gid + '">' + esc(g.name) + (g.illustrative ? ui.illustrative() : '') + '</h2>' +
      '<p class="card-desc">' + esc(g.blurb) + '</p></div></div>' + statusPill(gs) + '</div>' +
      '<div class="card-body stack">' + parts.join('') + '</div><div class="card-footer">' + foot.join('') + '</div></section>';
  }

  function directCard() {
    var p = A.profile();
    var lastUpload = A.assetsFor(p.id).filter(function (a) { return (a.sourceRefs || []).some(function (r) { var s = A.sourceById(r.sourceId); return s && s.provider === 'upload'; }); })
      .sort(function (x, y) { return A.toMs(y.createdAt) - A.toMs(x.createdAt); })[0];
    function row(ic, name, desc, tab) {
      return '<li><span class="ik-mono" aria-hidden="true">' + icon(ic) + '</span><span class="stack-sm grow" style="gap:0"><span class="medium">' + esc(name) + '</span><span class="xs muted">' + esc(desc) + '</span></span>' +
        btn(name, 'intake-goto-new', { data: { tab: tab }, variant: 'ghost', icon: 'arrow-right', iconOnly: true }) + '</li>';
    }
    return '<section class="card" aria-labelledby="ik-prov-direct"><div class="card-header with-border"><div class="row"><span class="ik-mono" aria-hidden="true">' + icon('upload') + '</span>' +
      '<div><h2 class="card-title" id="ik-prov-direct">Upload, paste or import</h2><p class="card-desc">No account needed</p></div></div>' +
      '<span class="ik-status"><span class="dot dot-ok" aria-hidden="true"></span>Always available</span></div>' +
      '<div class="card-body stack"><p class="small">Works without connecting anything, so there is always a way in. Items go straight to preflight and the queue.</p>' +
      '<ul class="ik-svc">' + row('upload', 'Upload files', 'PNG, JPG, PDF, HTML, .eml', 'upload') + row('clipboard', 'Paste copy', 'Headline, body, disclosures, CTA', 'paste') +
      row('sheet', 'Import CSV/XLSX', 'One row per creative, with a column mapper', 'import') + '</ul></div>' +
      '<div class="card-footer"><span class="small muted">' + (lastUpload ? 'Last used ' + esc(ui.relTime(lastUpload.createdAt)) + ' · ' + esc(lastUpload.id) : 'Not used yet') + '</span></div></section>';
  }

  function statesGallery() {
    function mini(title, status, body, tag) {
      return '<div class="card ik-mini"><div class="card-header"><div class="card-title">' + esc(title) + ui.illustrative() + '</div>' + statusPill(status) + '</div>' +
        '<div class="card-body stack-sm"><p class="small">' + body + '</p>' + (tag || '') + '</div></div>';
    }
    return '<section class="section" aria-labelledby="ik-states-title"><div class="section-header"><div><h2 class="section-title" id="ik-states-title">Other connection states</h2>' +
      '<p class="section-desc">How a card reads in states the sample data doesn\'t show right now. Needs reconnect is live on the Microsoft card.</p></div></div>' +
      '<div class="grid grid-3">' +
      mini('Gmail', 'resyncing-gap', 'Gmail\'s change history expired after a long gap, so we rescan the last 7 days. Items already imported are matched by message ID and file hash, not duplicated.',
        '<div class="meter-row">' + ui.meter(4, 7, { label: 'Rescan progress', auto: false }) + '<span class="num xs">4 of 7 days</span></div>') +
      mini('Outlook', 'owner-removed', 'Connected by Marcus Lee, who left this profile. Syncing stopped. Imported items and their history stay. Any member can reconnect with their own account.') +
      mini('Google Drive', 'error', 'Google returned errors on the last 3 runs. We retry every 15 minutes and pick up from the last checkpoint, so nothing is lost.') +
      '</div><p class="xs muted">The Gmail card above can also show Resyncing after gap: use More, then "Simulate expired Gmail history".</p></section>';
  }

  function renderSources() {
    return '<div class="page">' + header('sources') +
      ui.callout('info', 'Read-only by design', 'Compliance Workbench only reads. It never sends, edits or deletes anything in a connected account. Connections go through Nango, the integration service we use, so consent screens show Nango.') +
      '<div class="ik-prov-grid">' + provCard('google') + provCard('microsoft') + directCard() + '</div>' + statesGallery() + '</div>';
  }

  /* ---------- Connect flow ---------- */
  var FLOW_ID = 'src-connect-dialog';
  function flowView(f) {
    var g = GROUPS[f.group];
    var acts;
    if (f.step === 'intro') {
      var reconnect = sourcesFor(f.profileId, f.group).some(function (s) { return (s.syncLog || []).length; });
      return {
        title: (reconnect ? 'Reconnect ' : 'Connect ') + g.name,
        body: '<p>One click connects ' + esc(g.blurb) + '.</p>' +
          ui.callout('success', 'Read-only', 'Compliance Workbench only reads. It never sends, edits or deletes anything in your account.', { icon: 'lock' }) +
          '<div class="stack-sm"><span class="ik-label">What happens next</span><ol class="ik-ol">' +
          '<li>' + esc(g.consentNote) + ' The screens show Nango, the integration service Compliance Workbench uses.</li>' +
          '<li>Discovery runs right away over the last 90 days' + (reconnect ? ', and anything already imported is matched, not duplicated' : '') + '.</li>' +
          '<li>Likely submissions and uncertain items go to Triage. Nothing reaches the review queue until a member accepts it.</li></ol></div>' +
          '<div class="stack-sm"><span class="ik-label">What we read</span><ul class="ik-svc">' + g.reads.map(function (r) {
            return '<li>' + ui.sourceIcon(r[0], { label: true }) + '<span class="ik-svc-meta">' + esc(r[1]) + '</span></li>';
          }).join('') + '</ul></div>' +
          '<p class="xs muted">What we watch starts as Smart watch. You can narrow it to labels or folders later; it\'s never required. No folder pickers, no admin steps.</p>',
        actions: [{ label: 'Cancel', action: 'dialog-close' }, { label: 'Continue to ' + g.name, action: 'src-flow-next', variant: 'default', icon: 'arrow-right' }]
      };
    }
    if (f.step === 'consent') {
      var c = g.consents[f.consentIdx], u = me();
      return {
        title: g.name + ' asks for access',
        body: '<div class="row between small muted"><span>Screen ' + (f.consentIdx + 1) + ' of ' + g.consents.length + ' · ' + esc(c.service) + '</span>' + (g.illustrative ? ui.illustrative() : '') + '</div>' +
          '<div class="ik-consent" role="group" aria-label="Simulated ' + esc(g.name) + ' consent screen">' +
          '<div class="ik-consent-bar">' + icon('lock') + '<span>Sign in with ' + esc(g.name) + '</span><span class="spacer"></span>' + ui.tag('simulated') + '</div>' +
          '<div class="ik-consent-body"><span class="ik-acct">' + ui.avatar(u, { size: 'sm' }) + '<span>' + esc(u.email) + '</span></span>' +
          '<h3 class="ik-consent-title">Nango wants to access your ' + esc(g.name) + ' Account</h3>' +
          '<p class="small muted">Nango is the integration service that Compliance Workbench uses to connect to ' + esc(g.name) + '.</p>' +
          '<div class="small strong">This will allow Nango to:</div><ul class="ik-perms">' + c.scopes.map(function (sc) { return '<li>' + icon(sc.icon) + '<span>' + esc(sc.text) + '</span></li>'; }).join('') + '</ul>' +
          '<p class="xs muted">' + esc(c.note) + ' You can remove access any time in your ' + esc(g.name) + ' account settings.</p></div></div>',
        actions: [{ label: 'Cancel', action: 'src-flow-deny' }, { label: 'Allow', action: 'src-flow-allow', variant: 'default' }]
      };
    }
    if (f.step === 'discover') {
      var steps = g.discoverSteps;
      var pct = Math.round(Math.min(f.stage, steps.length) / steps.length * 100);
      return {
        title: 'Discovering…',
        body: '<p class="small">Connected. Looking for marketing submissions in the last 90 days. You can close this; discovery keeps running and results land in Triage.</p>' +
          ui.steps(steps, f.stage) + '<div class="meter-row">' + ui.meter(pct, 100, { label: 'Discovery progress', auto: false }) + '<span class="num xs">' + pct + '%</span></div>',
        actions: [{ label: 'Continue in background', action: 'dialog-close' }]
      };
    }
    if (f.step === 'preview') {
      var res = f.result;
      var tiles = '<div class="grid grid-3">' +
        '<div class="tile"><div class="tile-label">' + icon('tag') + 'Likely submissions</div><div class="tile-value">' + res.likely + '</div><div class="tile-meta">Go to Triage</div></div>' +
        '<div class="tile"><div class="tile-label">' + icon('help') + 'Uncertain</div><div class="tile-value">' + res.uncertain + '</div><div class="tile-meta">Go to Triage for a look</div></div>' +
        '<div class="tile"><div class="tile-label">' + icon('circle-slash') + 'Not marketing</div><div class="tile-value">' + res.notMarketing.toLocaleString('en-US') + '</div><div class="tile-meta">Skipped, not stored</div></div></div>';
      var ex = res.examples.map(function (x) {
        return '<tr><td class="shrink">' + ui.sourceIcon(x.provider) + '</td><td><span class="cell-title">' + esc(x.title) + '</span><span class="cell-sub">' + esc(x.reason) + '</span></td>' +
          '<td class="shrink">' + classBadge(x.classification) + (x.already ? '<div class="xs muted mt-4">Already in Triage</div>' : '') + '</td></tr>';
      }).join('');
      return {
        title: g.name + ' connected',
        body: '<p class="small">' + esc(res.scanned) + '</p>' + tiles +
          '<div class="stack-sm"><span class="ik-label">Examples</span><div class="table-wrap"><table class="table table-dense"><caption class="sr-only">Discovery examples</caption><tbody>' + ex + '</tbody></table></div></div>' +
          '<p class="xs muted">What we watch: ' + esc(SMART[f.group]) + '. You can narrow it later in Sources; it\'s never required. Classification ran rules first and used AI only when unsure (sample cost $0.0061).</p>',
        actions: [{ label: 'Done', action: 'src-flow-done', variant: 'default', icon: 'check' }]
      };
    }
    // cancelled
    acts = [{ label: 'Close', action: 'dialog-close' }, { label: 'Try again', action: 'src-flow-retry', variant: 'default', icon: 'refresh' }];
    return {
      title: 'Nothing was connected',
      body: ui.callout('neutral', 'You cancelled on the ' + g.name + ' screen', 'Compliance Workbench didn\'t get access and read nothing. You can try again any time, or keep using Upload, Paste and Import.'),
      actions: acts
    };
  }
  function flowRender(create) {
    var f = st.flow;
    if (!f || f.background) return;
    var view = flowView(f);
    var dlg = document.getElementById(FLOW_ID);
    if (!create && dlg && A.isDialogOpen()) {
      var t = dlg.querySelector('.dialog-title');
      if (t) t.textContent = view.title;
      var body = document.getElementById(FLOW_ID + '-body');
      if (body) body.innerHTML = view.body;
      var foot = dlg.querySelector('.dialog-footer');
      if (foot) {
        foot.innerHTML = view.actions.map(function (ac) { return ui.button(ac.label, { action: ac.action || 'dialog-close', variant: ac.variant || 'outline', data: ac.data, icon: ac.icon }); }).join('');
        var pri = foot.querySelector('.btn-default:not([disabled])') || foot.querySelector('.btn:not([disabled])');
        if (pri) { try { pri.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
      return;
    }
    A.dialog({ id: FLOW_ID, title: view.title, body: view.body, actions: view.actions, size: 'md', initialFocus: '.dialog-footer .btn-default', onClose: flowClosed });
  }
  function flowClosed() {
    var f = st.flow;
    if (!f || f.finished) return;
    if (f.consented) {
      if (f.step === 'preview') { finishFlow(f); return; }
      f.background = true;
      A.toast('Discovery keeps running. New items will appear in Triage.', 'info');
    } else {
      st.flow = null;
    }
  }
  function startFlow(gid) {
    if (st.flow && !st.flow.finished && st.flow.background) { A.toast('Discovery for ' + GROUPS[st.flow.group].name + ' is still running. Results land in Triage.', 'info'); return; }
    st.flow = { token: A.uid('flow'), group: gid, step: 'intro', consentIdx: 0, consented: false, profileId: pid(), finished: false, background: false, stage: 0, result: null };
    flowRender(true);
  }
  function ensureSource(profileId, gid, provider) {
    var s = S().sources.find(function (x) { return x.profileId === profileId && x.provider === provider; });
    if (!s) {
      s = { id: 'src-' + provider + '-' + A.uid('c').slice(-6), profileId: profileId, provider: provider, group: gid, account: null, connectedBy: null, status: 'not-connected',
        illustrative: gid === 'microsoft' || provider === 'google-sheets', watch: null, watchDetail: null, lastSyncAt: null, itemsFound: 0, syncLog: [] };
      S().sources.push(s);
    }
    return s;
  }
  function markConsented(f) {
    var g = GROUPS[f.group], u = me();
    g.services.forEach(function (svc) {
      var s = ensureSource(f.profileId, f.group, svc);
      var wasBroken = s.status === 'needs-reconnect' || effStatus(s) === 'owner-removed';
      var hadLog = (s.syncLog || []).length > 0;
      s.account = u.email; s.connectedBy = u.id; s.status = 'syncing';
      if (!s.watch) { s.watch = 'smart'; s.watchDetail = SMART[f.group]; }
      s.syncLog = s.syncLog || [];
      if (wasBroken || hadLog) {
        s.syncLog.unshift({ at: A.nowIso(), kind: 'connection', summary: 'Reconnected by ' + u.name + '. Resumed from the last checkpoint' + (s.lastSyncAt ? ' (' + ui.time(s.lastSyncAt) + ')' : '') + '. Nothing lost; imported items were matched, not duplicated.' });
        s._resumed = true;
      }
    });
    A.logProfile(u.name, 'source', 'Allowed read-only access to ' + g.blurb + ' through Nango.', f.profileId);
    A.emit('data-changed', { kind: 'source' });
    rr();
  }
  function arrivalToItem(key, profileId, at) {
    var x = ARRIVALS[key];
    var src = S().sources.find(function (s) { return s.profileId === profileId && s.provider === x.provider; });
    if (!src) return null;
    if (S().intake.some(function (i) { return i.profileId === profileId && i.title === x.title; })) return null;
    var it = {
      id: nextIntakeId(), profileId: profileId, sourceId: src.id, kind: x.kind, title: x.title, sender: x.sender, receivedAt: at,
      snippet: x.snippet, classification: x.classification, reason: x.reason, candidates: A.clone(x.candidates),
      inferred: { product: x.inferred.product, channel: x.inferred.channel, confirmed: false }, status: 'pending', draft: A.clone(x.draft)
    };
    S().intake.push(it);
    src.itemsFound = (src.itemsFound || 0) + 1;
    return it;
  }
  function computeDiscovery(f) {
    var g = GROUPS[f.group], d = g.discovery;
    var examples = d.arrivals.map(function (k) {
      var x = ARRIVALS[k];
      var already = S().intake.some(function (i) { return i.profileId === f.profileId && i.title === x.title; });
      return { key: k, provider: x.provider, title: x.title, reason: x.reason, classification: x.classification, already: already };
    }).concat(d.skipped.map(function (x) { return { provider: x.provider, title: x.title, reason: x.reason, classification: 'not-marketing' }; }));
    return {
      scanned: d.scanned, notMarketing: d.notMarketing, examples: examples,
      likely: examples.filter(function (x) { return x.classification === 'marketing'; }).length,
      uncertain: examples.filter(function (x) { return x.classification === 'uncertain'; }).length
    };
  }
  function runDiscovery(f) {
    var g = GROUPS[f.group];
    var step = function () {
      later(function () {
        if (st.flow !== f) return;
        f.stage += 1;
        if (f.stage >= g.discoverSteps.length) {
          f.result = computeDiscovery(f);
          if (f.background) { finishFlow(f); return; }
          f.step = 'preview';
          flowRender(false);
          return;
        }
        flowRender(false);
        step();
      }, 560);
    };
    step();
  }
  function finishFlow(f) {
    if (!f || f.finished) return;
    f.finished = true;
    if (!f.result) f.result = computeDiscovery(f);
    if (document.getElementById(FLOW_ID) && A.isDialogOpen()) A.closeDialog();
    if (st.flow === f) st.flow = null;
    var g = GROUPS[f.group], d = g.discovery, u = me();
    var created = [];
    d.arrivals.forEach(function (k, i) { var it = arrivalToItem(k, f.profileId, minutesAgo(60 * 24 * (i * 9 + 2))); if (it) created.push(it); });
    g.services.forEach(function (svc) {
      var s = ensureSource(f.profileId, f.group, svc);
      if (!s._resumed) s.syncLog.unshift({ at: A.nowIso(), kind: 'initial', summary: d.logs[svc] });
      delete s._resumed;
    });
    A.logProfile(u.name, 'source', g.name + ' connected. Discovery found ' + A.plural(created.length, 'new item') + ' for Triage.', f.profileId);
    A.notify(g.name + ' connected by ' + u.name + ': ' + A.plural(created.length, 'new item') + ' waiting in Triage.', '#intake-triage');
    A.emit('data-changed', { kind: 'source' });
    A.toast(g.name + ' connected. ' + (created.length ? A.plural(created.length, 'item') + ' added to Triage.' : 'Nothing new; everything found was already imported.'), 'success');
    rr();
    later(function () {
      sourcesFor(f.profileId, f.group).forEach(function (s) {
        if (s.status === 'syncing') { s.status = 'connected'; s.lastSyncAt = A.nowIso(); }
      });
      A.emit('data-changed', { kind: 'source' });
      rr();
    }, 1800);
  }

  A.action('src-connect', function (el) { startFlow(el.dataset.group); });
  A.action('src-flow-next', function () { var f = st.flow; if (!f) return; f.step = 'consent'; f.consentIdx = 0; flowRender(false); });
  A.action('src-flow-allow', function () {
    var f = st.flow; if (!f || f.step !== 'consent') return;
    var g = GROUPS[f.group];
    if (f.consentIdx < g.consents.length - 1) { f.consentIdx += 1; flowRender(false); return; }
    f.consented = true; f.step = 'discover'; f.stage = 0;
    markConsented(f);
    flowRender(false);
    runDiscovery(f);
  });
  A.action('src-flow-deny', function () { var f = st.flow; if (!f) return; f.step = 'cancelled'; flowRender(false); });
  A.action('src-flow-retry', function () { var f = st.flow; if (!f) return; f.step = 'intro'; f.consentIdx = 0; flowRender(false); });
  A.action('src-flow-done', function () { var f = st.flow; if (f) finishFlow(f); });

  /* ---------- Sync now, gap rescan, log, narrow, disconnect ---------- */
  function syncNow(gid) {
    var profileId = pid();
    var list = sourcesFor(profileId, gid).filter(function (s) { return effStatus(s) === 'connected'; });
    if (!list.length) { A.toast(GROUPS[gid].name + ' isn\'t connected. Reconnect it first.', 'warning'); return; }
    list.forEach(function (s) { s.status = 'syncing'; });
    A.emit('data-changed', { kind: 'source' });
    A.rerender();
    later(function () {
      var now = A.nowIso(), runId = A.uid('sync');
      var fresh = sourcesFor(profileId, gid).filter(function (s) { return s.status === 'syncing'; });
      if (!fresh.length) return;
      var gm = fresh.find(function (s) { return s.provider === 'gmail'; });
      var dr = fresh.find(function (s) { return s.provider === 'google-drive'; });
      var summary = 'No changes since the last sync.';
      var newItems = [], newVer = null;
      if (gid === 'google' && gm && dr && !gm.demoSyncDone) {
        gm.demoSyncDone = true;
        var i1 = arrivalToItem('story', profileId, now), i2 = arrivalToItem('landing', profileId, now);
        if (i1) newItems.push(i1);
        if (i2) newItems.push(i2);
        var a107 = A.asset('A-107', { anyProfile: true });
        if (a107 && a107.profileId === profileId && a107.versions.length === 1) {
          var nv = A.newVersion('A-107', { origin: 'sync', authorName: 'Priya Shah', sections: [sec('s4', 'Footer', 'ClearPath Financial, 100 Example Ave, Austin, TX 78701. Unsubscribe or update your preferences.')] });
          if (nv) {
            nv.findings.forEach(function (fd) { if (/^F107-1-1$/.test(fd.carriedFrom || '')) fd.recheck = 'resolved'; });
            patchVersionEvent(a107, nv);
            A.log('A-107', 'System', 'version', 'Google Drive: Simplify_newsletter_final.pdf changed (same file ID). Priya added the unsubscribe link and postal address, so it became V' + nv.n + ' automatically.');
            newVer = nv;
            var rec = {
              id: nextIntakeId(), profileId: profileId, sourceId: dr.id, kind: 'file', title: 'Simplify_newsletter_final.pdf', sender: 'Priya Shah (Drive owner)', receivedAt: now,
              snippet: 'Marketing / Q4 Debt Payoff. Modified just now.', classification: 'new-version', reason: 'Same Drive file modified (same file ID). Text changed, so it became V' + nv.n + ' of A-107 automatically.',
              candidates: [{ name: 'Simplify_newsletter_final.pdf', type: 'pdf', sizeKb: 418 }], inferred: { product: 'personal_loan', channel: 'email', confirmed: true },
              newVersionOf: 'A-107', status: 'accepted', assetId: 'A-107', versionId: nv.id
            };
            S().intake.push(rec);
          }
        }
        var nNew = newItems.length;
        summary = '+' + nNew + ' new, ' + (newVer ? '1 modified → A-107 V' + newVer.n : '0 modified') + ', 3 skipped (not marketing), 0 errors';
        fresh.forEach(function (s) {
          var part = s.provider === 'gmail' ? (i1 ? '+1 new message (' + i1.id + '). ' : 'No new messages. ') + '2 skipped as not marketing. 0 errors.' :
            s.provider === 'google-drive' ? (i2 ? '+1 new file (' + i2.id + '). ' : '') + (newVer ? '1 modified → A-107 V' + newVer.n + '. ' : '') + '1 skipped as not marketing. 0 errors.' : 'No new rows.';
          s.syncLog.unshift({ at: now, kind: 'incremental', summary: part, run: runId, runSummary: summary });
        });
      } else {
        fresh.forEach(function (s) {
          var part = isMail(s.provider) ? 'No new messages.' : (s.provider === 'google-sheets' || s.provider === 'excel') ? 'No new rows.' : 'No changes.';
          s.syncLog.unshift({ at: now, kind: 'incremental', summary: part, run: runId, runSummary: summary });
        });
      }
      fresh.forEach(function (s) { s.status = 'connected'; s.lastSyncAt = now; });
      A.logProfile(me().name, 'source', 'Sync now (' + GROUPS[gid].name + '): ' + summary, profileId);
      if (newItems.length) A.notify(A.plural(newItems.length, 'new item') + ' from ' + GROUPS[gid].name + ' waiting in Triage.', '#intake-triage');
      A.emit('data-changed', { kind: 'source' });
      A.toast(GROUPS[gid].name + ' synced: ' + summary + '.', newItems.length || newVer ? 'success' : 'default');
      rr();
    }, 1500);
  }
  function simulateGap(gid) {
    var profileId = pid();
    var gm = sourcesFor(profileId, gid).find(function (s) { return s.provider === 'gmail' && effStatus(s) === 'connected'; });
    if (!gm) { A.toast('Gmail must be connected to show this.', 'info'); return; }
    gm.status = 'resyncing-gap';
    st.gap[gid] = { done: 0, total: 7 };
    A.emit('data-changed', { kind: 'source' });
    A.toast('Simulating: Gmail\'s change history expired. Rescanning the last 7 days.', 'info');
    A.rerender();
    var step = function () {
      later(function () {
        var s = A.sourceById(gm.id);
        if (!s || s.status !== 'resyncing-gap') return;
        var gp = st.gap[gid] || { done: 0, total: 7 };
        gp.done += 1; st.gap[gid] = gp;
        if (gp.done < gp.total) { rr(); step(); return; }
        s.status = 'connected'; s.lastSyncAt = A.nowIso();
        s.syncLog.unshift({ at: A.nowIso(), kind: 'gap-rescan', summary: 'Gmail history expired → rescanned 7 days: 0 new, 14 already imported. Nothing lost.' });
        delete st.gap[gid];
        A.logProfile(me().name, 'source', 'Gmail gap rescan finished: 0 new, 14 already imported.', profileId);
        A.emit('data-changed', { kind: 'source' });
        A.toast('Gap rescan finished: 0 new, 14 already imported. Nothing lost.', 'success');
        rr();
      }, 420);
    };
    step();
  }
  var KIND = {
    'initial': { label: 'Initial backfill', tone: 'blue' },
    'incremental': { label: 'Incremental', tone: 'gray' },
    'gap-rescan': { label: 'Gap rescan', tone: 'amber' },
    'error': { label: 'Error', tone: 'red' },
    'connection': { label: 'Connection', tone: 'slate' }
  };
  function logBody(gid) {
    var list = sourcesFor(pid(), gid);
    var filt = st.logFilter || 'all';
    var entries = [];
    list.forEach(function (s) { (s.syncLog || []).forEach(function (e) { if (filt === 'all' || s.provider === filt) entries.push({ e: e, s: s }); }); });
    entries.sort(function (x, y) { return A.toMs(y.e.at) - A.toMs(x.e.at); });
    var rows = [], byRun = {};
    entries.forEach(function (x) {
      if (x.e.run && filt === 'all') {
        if (byRun[x.e.run]) { byRun[x.e.run].parts.push(x); return; }
        byRun[x.e.run] = { at: x.e.at, kind: x.e.kind, text: x.e.runSummary, parts: [x] };
        rows.push(byRun[x.e.run]);
      } else rows.push({ at: x.e.at, kind: x.e.kind, text: x.e.summary, parts: [x], single: true });
    });
    var seg = '<div class="seg" role="group" aria-label="Filter by service">' + ['all'].concat(GROUPS[gid].services).map(function (p) {
      return '<button type="button" data-action="src-log-filter" data-group="' + esc(gid) + '" data-filter="' + esc(p) + '" aria-pressed="' + (filt === p) + '">' + esc(p === 'all' ? 'All' : providerLabel(p)) + '</button>';
    }).join('') + '</div>';
    var tl = rows.length ? '<ol class="timeline">' + rows.map(function (r) {
      var k = KIND[r.kind] || { label: r.kind, tone: 'gray' };
      var srcs = r.parts.map(function (x) { return x.s.provider; }).filter(function (p, i, arr) { return arr.indexOf(p) === i; });
      return '<li class="tl-item"><span class="tl-dot' + (r.kind === 'initial' || r.kind === 'error' ? ' is-strong' : '') + '"></span>' +
        '<div class="tl-head"><span class="badge tone tone-' + k.tone + '">' + esc(k.label) + '</span><span class="row row-tight">' + srcs.map(function (p) { return ui.sourceIcon(p); }).join('') + '</span>' +
        '<span class="tl-time">' + esc(ui.time(r.at)) + '</span></div><div class="tl-text">' + esc(r.text) + '</div>' +
        (!r.single && r.parts.length > 0 ? '<ul class="ik-cands mt-4">' + r.parts.map(function (x) { return '<li class="ik-cand xs">' + ui.sourceIcon(x.s.provider) + '<span>' + esc(x.e.summary) + '</span></li>'; }).join('') + '</ul>' : '') + '</li>';
    }).join('') + '</ol>' : ui.empty('No runs yet', 'Runs appear here after the first sync.');
    return seg + '<p class="xs muted">Each run reads only what changed since the last checkpoint. When a connection breaks, imported items stay and the next run picks up from the checkpoint.</p>' + tl;
  }
  function openLog(gid) {
    A.drawer({ id: 'src-log-drawer', title: GROUPS[gid].name + ' sync log', body: logBody(gid), width: 'lg',
      footer: btn('Close', 'drawer-close', { variant: 'outline' }) });
  }
  function openNarrow(gid) {
    var g = GROUPS[gid];
    var list = sourcesFor(pid(), gid).filter(function (s) { return s.account && effStatus(s) !== 'not-connected'; });
    if (!list.length) { A.toast('Connect ' + g.name + ' first.', 'info'); return; }
    var cur = list[0], narrowed = cur.watch === 'narrowed', sel = cur.watchScope || [];
    var opts = g.narrow.map(function (grp, gi) {
      return '<div class="stack-sm"><span class="ik-label">' + esc(grp.kind) + '</span>' + grp.items.map(function (item, ii) {
        var id = 'ik-watch-' + gi + '-' + ii;
        return '<label class="check" for="' + id + '"><input type="checkbox" class="ik-watch-opt" id="' + id + '" data-value="' + esc(item) + '"' + (sel.indexOf(item) >= 0 ? ' checked' : '') + (narrowed ? '' : ' disabled') + '><span>' + esc(item) + '</span></label>';
      }).join('') + '</div>';
    }).join('');
    A.dialog({
      id: 'src-narrow-dialog', title: 'What we watch in ' + g.name, size: 'md',
      body: '<fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="sr-only">Watch mode</legend>' +
        '<label class="check ik-radio-row" for="ik-watch-smart"><input type="radio" name="ik-watch-mode" id="ik-watch-smart" value="smart" data-change="src-narrow-mode"' + (narrowed ? '' : ' checked') + '>' +
        '<span><span class="medium">Smart watch (recommended)</span><span class="small muted" style="display:block">Detect marketing submissions across all mail and files we can read. Nothing to set up.</span></span></label>' +
        '<label class="check ik-radio-row" for="ik-watch-narrow"><input type="radio" name="ik-watch-mode" id="ik-watch-narrow" value="narrowed" data-change="src-narrow-mode"' + (narrowed ? ' checked' : '') + '>' +
        '<span><span class="medium">Only these labels and folders</span><span class="small muted" style="display:block">Optional. Useful if a shared inbox gets a lot of unrelated mail.</span></span></label>' +
        '<div class="ik-opts" id="ik-watch-opts">' + opts + '</div></fieldset>',
      actions: [{ label: 'Cancel', action: 'dialog-close' }, { label: 'Save', action: 'src-narrow-save', variant: 'default', data: { group: gid } }]
    });
  }
  function moreMenu(el, gid) {
    var g = GROUPS[gid];
    var list = sourcesFor(pid(), gid);
    var gs = groupStatus(list);
    var items = [{ heading: g.name }];
    if (gs === 'connected') items.push({ label: 'Narrow what we watch…', icon: 'filter', action: 'src-narrow', data: { group: gid } });
    items.push({ label: 'View sync log', icon: 'history', action: 'src-log', data: { group: gid } });
    if (gid === 'google' && list.some(function (s) { return s.provider === 'gmail' && effStatus(s) === 'connected'; })) {
      items.push({ label: 'Simulate expired Gmail history', hint: 'Demo: shows Resyncing after gap', icon: 'clock', action: 'src-gap', data: { group: gid } });
    }
    items.push({ sep: true });
    items.push({ label: 'Disconnect ' + g.name, icon: 'x', action: 'src-disconnect', data: { group: gid }, danger: true });
    A.menu(el, items, { align: 'end', label: g.name + ' options', minWidth: 250 });
  }

  A.action('src-sync', function (el) { syncNow(el.dataset.group); });
  A.action('src-gap', function (el) { simulateGap(el.dataset.group); });
  A.action('src-log', function (el) { st.logFilter = 'all'; openLog(el.dataset.group); });
  A.action('src-log-filter', function (el) { st.logFilter = el.dataset.filter || 'all'; openLog(el.dataset.group); });
  A.action('src-more', function (el) { moreMenu(el, el.dataset.group); });
  A.action('src-narrow', function (el) { openNarrow(el.dataset.group); });
  A.action('src-narrow-mode', function () {
    var narrow = document.getElementById('ik-watch-narrow');
    var on = !!(narrow && narrow.checked);
    Array.prototype.forEach.call(document.querySelectorAll('.ik-watch-opt'), function (cb) { cb.disabled = !on; });
  });
  A.action('src-narrow-save', function (el) {
    var gid = el.dataset.group, g = GROUPS[gid];
    var narrow = document.getElementById('ik-watch-narrow');
    var mode = narrow && narrow.checked ? 'narrowed' : 'smart';
    var picked = Array.prototype.filter.call(document.querySelectorAll('.ik-watch-opt'), function (cb) { return cb.checked; }).map(function (cb) { return cb.getAttribute('data-value'); });
    if (mode === 'narrowed' && !picked.length) { A.toast('Pick at least one label or folder, or keep Smart watch.', 'warning'); return; }
    var detail = mode === 'smart' ? SMART[gid] : 'Only: ' + picked.join(', ');
    sourcesFor(pid(), gid).filter(function (s) { return s.account; }).forEach(function (s) { s.watch = mode; s.watchDetail = detail; s.watchScope = mode === 'smart' ? [] : picked; });
    A.logProfile(me().name, 'source', g.name + ' watch changed: ' + detail);
    A.emit('data-changed', { kind: 'source' });
    A.closeDialog();
    A.toast(mode === 'smart' ? g.name + ' is back on Smart watch.' : g.name + ' now watches ' + A.plural(picked.length, 'label or folder', 'labels and folders') + '.', 'success');
    A.rerender();
  });
  A.action('src-disconnect', function (el) {
    var gid = el.dataset.group, g = GROUPS[gid];
    A.confirmDialog({
      title: 'Disconnect ' + g.name + '?', confirmLabel: 'Disconnect', destructive: true, action: 'src-disconnect-confirm', data: { group: gid },
      body: '<p>Imported assets, versions and decisions stay. New mail and file changes stop arriving until someone reconnects.</p><p class="small muted mt-8">Nango deletes its saved sign-in for this account.</p>'
    });
  });
  A.action('src-disconnect-confirm', function (el) {
    var gid = el.dataset.group, g = GROUPS[gid], u = me();
    sourcesFor(pid(), gid).forEach(function (s) {
      if (s.status === 'not-connected' && !s.account) return;
      s.status = 'not-connected'; s.account = null; s.connectedBy = null; s.watch = null; s.watchDetail = null;
      s.syncLog = s.syncLog || [];
      s.syncLog.unshift({ at: A.nowIso(), kind: 'connection', summary: 'Disconnected by ' + u.name + '. Imported items stay; new changes stop arriving.' });
    });
    A.logProfile(u.name, 'source', 'Disconnected ' + g.name + '.');
    A.emit('data-changed', { kind: 'source' });
    A.closeDialog();
    A.toast(g.name + ' disconnected. Imported items stay.', 'success');
    A.rerender();
  });

  /* ------------------------------------------------------------------ */
  /* Routes and wiring                                                   */
  /* ------------------------------------------------------------------ */
  A.route('intake-triage', function () { return renderTriage(); }, { nav: 'intake', title: 'Intake · Triage' });
  A.route('intake-new', function () { return renderNew(); }, { nav: 'intake', title: 'Intake · New submission' });
  A.route('intake-sources', function () { return renderSources(); }, { nav: 'intake', title: 'Intake · Sources' });
  A.route('intake', function (param) { return param ? null : renderTriage(); }, { nav: 'intake', title: 'Intake · Triage' });

  A.on('rendered', function (r) {
    ensureCss();
    if (!r || !/^intake/.test(r.name || '')) return;
    if (st.focusId) {
      var el = document.getElementById(st.focusId);
      st.focusId = null;
      if (el) {
        try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        try { el.scrollIntoView({ block: 'nearest' }); } catch (e2) { /* ignore */ }
      }
    }
    if (r.name === 'intake-new') {
      var dz = document.getElementById('ik-dropzone');
      if (dz) {
        dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-over'); });
        dz.addEventListener('dragleave', function () { dz.classList.remove('is-over'); });
        dz.addEventListener('drop', function (e) {
          e.preventDefault();
          dz.classList.remove('is-over');
          var files = (e.dataTransfer && e.dataTransfer.files) || [];
          var added = 0;
          Array.prototype.forEach.call(files, function (file) {
            var ext = (String(file.name).split('.').pop() || '').toLowerCase();
            st.files.push({ name: file.name, type: ext, sizeKb: Math.max(1, Math.round((file.size || 0) / 1024)), real: true, product: st.meta.product || null, channel: st.meta.channel || null });
            added += 1;
          });
          if (added) { A.toast('Added ' + A.plural(added, 'file') + '. This prototype lists them by name and does not read their contents.', 'info'); A.rerender(); }
        });
      }
    }
  });

  st = fresh();
})();

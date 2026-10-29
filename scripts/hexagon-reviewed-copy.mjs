// MPC-8689: hand-written "what it could be used for" and "what you can do" text for the hexagons that the share list links to (owner decision 7, batch 2, 2026-10-29).
// The generated text in generate-hexagon-pages.mjs is general guidance picked by keyword and is wrong for some of these (for example it mentions SIM-swap fraud for a voice or a fax header).
// Each entry says only what the fact itself supports. Slug -> { heads, uses (4), todo (3) }. A page with an entry is tagged "Text reviewed 2026-10-29".
export const REVIEWED_ON = '2026-10-29';
export const REVIEWED = {
  'webrtc-leak': {
    heads: 'Reveal the internet address your VPN is meant to hide',
    uses: [
      'A website can learn the real internet address behind your VPN, which ties your visit to your actual connection.',
      'That address points to your internet provider and roughly your city, so it shows where you probably are.',
      'Trackers can use it to recognise you across visits even when you change VPN servers.',
      'If you rely on a VPN for privacy, you may be exposed without ever seeing a warning.',
    ],
    todo: ['Test your VPN for leaks; a WebRTC test page will show the address your browser gives away.', 'Turn WebRTC off or restrict it in your browser settings, or with a trusted extension.', 'Choose a VPN that says it blocks WebRTC leaks and test it again after updates.'],
  },
  'name-in-your-address': {
    heads: 'Make an address say who you are',
    uses: [
      'Anyone who gets the address can guess a first name, an initial or an age from the part before the @.',
      'A guessed name makes a phishing or scam message feel personal.',
      'The same name or number pattern in other addresses and usernames helps link your accounts together.',
      'Combined with other leaked details such as a date of birth or a data-broker record, it helps identify you.',
    ],
    todo: ['Use a separate address with no name in it for sign-ups and shops.', 'Keep an address with your real name for people you trust.', 'Use aliases (plus-addresses or a hide-my-email service) so one address is not used everywhere.'],
  },
  'at-username': {
    heads: 'Put a name and a handle to a chat',
    uses: [
      'A Telegram bot, and whoever runs it, receives your first name, last name and @username with your first message, without you sharing anything.',
      'Searching the same @username on other sites can find your accounts there and link them to your Telegram.',
      'A public @username lets strangers message you or look up your public profile.',
      'A name and a handle are enough to start a convincing impersonation or scam message.',
    ],
    todo: ['Use an @username that you do not use anywhere else.', 'Set a name you are comfortable sharing with every bot you message.', 'Check Settings, Privacy and Security for who can find and message you.'],
  },
  'sms-phone-number': {
    heads: 'Reach you, and sign in as you',
    uses: [
      'Every text gives the receiver your full phone number, which can be saved, shared or matched to other records.',
      'Many sites use your number to log in or reset a password, so knowing it is a first step towards trying to take over those accounts.',
      'Anyone with the number can call or text you directly, including scammers who quote details they found elsewhere.',
      'In a SIM-swap, an attacker persuades your mobile provider to move your number to their SIM so they receive your login codes.',
    ],
    todo: ['Use a second number for sign-ups and shops.', 'Ask your mobile provider for a PIN or port-out lock on your account.', 'Prefer an authenticator app or a security key over texted login codes.'],
  },
  'phone-number-whatsapp-id': {
    heads: 'Reveal the number behind a chat',
    uses: [
      'A business you message can see the phone number behind your account, unless you use a WhatsApp username.',
      'The number can be matched to other records and accounts that use it to log in.',
      'It lets someone contact you outside WhatsApp, and lets a scammer quote details they found elsewhere.',
      'In a SIM-swap, an attacker moves your number to their SIM to receive your login codes.',
    ],
    todo: ['Check who can see your number and profile in WhatsApp privacy settings.', 'Use a username instead of your number if it is offered to you.', 'Do not message unknown businesses from your main number.'],
  },
  'profile-name': {
    heads: 'Tell a business who you are',
    uses: [
      'Every business you message on WhatsApp sees the name on your profile.',
      'A real name makes it easier to find your other accounts and public records.',
      'A scammer who knows your name sounds credible, or can pretend to be you to people you know.',
      'A nickname you use on other sites links those accounts to this one.',
    ],
    todo: ['Use a name you are comfortable sharing with any business you message.', 'Check who can see your profile photo and about text.', 'Keep family and workplace details out of your profile.'],
  },
  'username-and-display-name': {
    heads: 'Link a Discord identity to the rest of your life',
    uses: [
      'An app you run a command in receives your username and display name.',
      'Searching the same name on other sites can find your accounts there.',
      'A display name that is your real name connects your community or gaming life to your real identity.',
      'A name and a handle are enough to impersonate you.',
    ],
    todo: ['Use different usernames on different sites.', 'Keep your display name separate from your real name if you want that separation.', 'Review which apps you have authorised and remove the ones you do not use.'],
  },
  'viber-name-and-photo': {
    heads: 'Match a name and a face to a chat',
    uses: [
      'A Viber bot receives your name and photo as soon as you message it (placeholders if you turned off personalisation).',
      'A photo can be matched with image search to find you elsewhere.',
      'A name and a photo together make a convincing fake profile.',
      'Together they let someone confirm who you are.',
    ],
    todo: ['Use a photo that you do not use on other sites.', 'Turn off personalisation in Viber if it is offered.', 'Think before messaging a bot or business you do not know.'],
  },
  'if-they-email-us-signature-block': {
    heads: 'Say who you are and where you work',
    uses: [
      'A signature with your job title, company and phone number tells the receiver exactly who you are and where you work.',
      'That detail makes a phishing or invoice scam look real.',
      'It can be used to pretend to be you, or your boss, to others at the company.',
      'The phone number can be called or matched to other records.',
    ],
    todo: ['Keep the signature short for emails to people outside your company.', 'Leave your personal mobile number out of it.', 'Be careful what you send back to unknown senders.'],
  },
  'caller-number': {
    heads: 'Tell a business how to reach you',
    uses: [
      'Any business you phone can see your number unless you withhold it.',
      'A saved number can be matched to other records, accounts and marketing lists.',
      'A scammer who knows it can call back pretending to be a service you used.',
      'A number used for everything links your different accounts together.',
    ],
    todo: ['Withhold your number when nobody needs to call you back.', 'Use a second number for businesses.', 'Never confirm personal details to someone who calls you; call them back on a number you looked up.'],
  },
  voice: {
    heads: 'Say more than the words',
    uses: [
      'Your voice carries your accent and a rough idea of your age, which can narrow down who you are.',
      'Background noise on a call can hint at where you are.',
      'A recorded call can be kept and shared, and a recorded voice can be used as a biometric.',
      'A recording can be used to imitate your voice in a scam call to family or your bank.',
    ],
    todo: ['Ask whether a call is being recorded.', 'Do not give sensitive details on a call you did not start.', 'Call back on a number you looked up yourself.'],
  },
  'header-line': {
    heads: 'Stamp who sent a page, and when',
    uses: [
      'Every faxed page prints the sender line: name, number, date, time and page count.',
      'That tells everyone who handles the paper who sent it and when.',
      'Faxes land in shared trays and machines, where other people can read them.',
      'The number can be called, or matched to the organisation behind it.',
    ],
    todo: ['Check what header your fax machine or service prints.', 'Send sensitive documents by a secure method instead.', 'Confirm that the recipient is at the machine.'],
  },
  'return-address': {
    heads: 'Tell a stranger where you live or work',
    uses: [
      'A return address tells whoever opens the envelope your name and where you live or work.',
      'That is enough to send you junk mail, visit, or look you up in property and people records.',
      'A home address on envelopes to businesses can end up in marketing databases.',
      'A work address links you to your employer.',
    ],
    todo: ['Use a PO box or your work address for business post.', 'Leave your name off the envelope if it is not needed.', 'Shred envelopes you no longer need.'],
  },
  'voice-recording': {
    heads: 'Send your voice to an account',
    uses: [
      'A voice note carries your voice, your accent and the sounds around you.',
      'The person who receives it can keep, forward or replay it.',
      'A voice can be used to imitate you in a scam.',
      'Background sounds can reveal where you are.',
    ],
    todo: ['Treat a voice note as something that can be forwarded.', 'Use text for anything sensitive.', 'Check who is in the chat before you send one.'],
  },
};

# Mail and gem gifts

Run `npm run mail:text` and open http://127.0.0.1:4176 to edit the rebalance letter. Save writes `shared/mailbox-copy.json`. It does not publish or send anything. The 75-gem amount and campaign ID are intentionally outside the text editor.

After deploying the server implementation, apply saved wording with an explicit target:

```
npm run mail:publish -- local wildwood-balance-local
npm run mail:publish -- maincloud wildwood-coop
```

The existing letter keeps its creation date, recipient cutoff, reward and read/claim receipts. Editing wording never grants another reward. Review the saved copy before publishing.

For future developer gem rewards, call `dev_publish_mailbox_letter` with a unique campaign ID, title, body and gem amount. It creates one shared letter eligible for existing real characters (including guests); gems are granted only on claim. Retrying the same ID cannot duplicate gems, and its amount cannot change after publication. No popup pauses gameplay.

Daily gems use the mailbox with their existing daily claim reducer. Outstanding older compensation notices appear as already received because those reducers previously credited gems immediately. Dismissed historical notices aren't recreated. The older compensation reducer paths also display their pending notices through mail; prefer the shared mailbox campaign for new gifts. Ads, purchases and ordinary gameplay rewards keep their existing direct flows.

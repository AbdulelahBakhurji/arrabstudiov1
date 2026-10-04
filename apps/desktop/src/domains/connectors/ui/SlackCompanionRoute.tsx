import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import type { ConnectorResource, SlackMentionMessage } from "@arrab/shared";
import { arrabApi } from "@/core/api/api";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { liveCompanions, useCompanionState } from "@/domains/companions/model/companions";
import { pushToast } from "@/domains/notifications/notify";

const ROUTE_KEY = "arrab.slack.routeCompanionId";

export function SlackCompanionRoute({ connectorId }: { connectorId: string }) {
  const { locale } = useLanguage();
  const ar = locale === "ar";
  const state = useCompanionState();
  const companions = liveCompanions(state);
  const [channels, setChannels] = useState<ConnectorResource[]>([]);
  const [channelId, setChannelId] = useState("");
  const [companionId, setCompanionId] = useState(
    () => localStorage.getItem(ROUTE_KEY) || "",
  );
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SlackMentionMessage[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void arrabApi
      .connectorResources(connectorId)
      .then((result) => {
        setChannels(result.items);
        setChannelId((current) => current || result.items[0]?.id || "");
      })
      .catch(() => undefined);
  }, [connectorId]);

  useEffect(() => {
    if (!channelId) return;
    void arrabApi
      .slackMentions(connectorId, { channelId, limit: 12 })
      .then((result) => setMentions(result.items))
      .catch(() => setMentions([]));
  }, [connectorId, channelId]);

  return (
    <section className="slack-route">
      <header>
        <MessageSquare size={15} />
        <div>
          <strong>{ar ? "توجيه Slack إلى رفيق" : "Route Slack to a companion"}</strong>
          <p>
            {ar
              ? "أرسل للقناة واسحب الإشارات الأخيرة إلى محادثة الرفيق."
              : "Send to a channel and pull recent mentions into a companion."}
          </p>
        </div>
      </header>
      <label>
        {ar ? "القناة" : "Channel"}
        <select className="cp-input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {ar ? "الرفيق" : "Companion"}
        <select
          className="cp-input"
          value={companionId}
          onChange={(e) => {
            setCompanionId(e.target.value);
            localStorage.setItem(ROUTE_KEY, e.target.value);
          }}
        >
          <option value="">{ar ? "اختر رفيقًا" : "Choose a companion"}</option>
          {companions.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <div className="slack-route-compose">
        <textarea
          className="cp-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={ar ? "رسالة للقناة…" : "Message the channel…"}
        />
        <button
          type="button"
          className="cp-button cp-primary"
          disabled={busy || !channelId || !draft.trim()}
          onClick={() => {
            setBusy(true);
            void arrabApi
              .sendSlack(connectorId, { channelId, text: draft.trim() })
              .then(() => {
                setDraft("");
                pushToast({
                  title: ar ? "أُرسلت إلى Slack" : "Sent to Slack",
                  tone: "success",
                });
              })
              .catch(() =>
                pushToast({
                  title: ar ? "تعذّر الإرسال" : "Could not send",
                  tone: "warn",
                }),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {ar ? "إرسال" : "Send"}
        </button>
      </div>
      <div className="slack-mentions">
        <strong>{ar ? "إشارات حديثة" : "Recent mentions"}</strong>
        {mentions.length === 0 ? (
          <p className="cp-muted">{ar ? "لا إشارات بعد." : "No mentions yet."}</p>
        ) : (
          <ul>
            {mentions.map((item) => (
              <li key={item.id}>
                <p>{item.text}</p>
                <small>
                  {item.channelName || item.channelId} ·{" "}
                  {new Date(item.timestamp).toLocaleString(locale)}
                </small>
                {companionId ? (
                  <button
                    type="button"
                    className="cp-text-button"
                    onClick={() => {
                      try {
                        localStorage.setItem(
                          "arrab.slack.pendingMention",
                          JSON.stringify({
                            companionId,
                            text: item.text,
                            at: Date.now(),
                          }),
                        );
                        pushToast({
                          title: ar ? "جاهز في غرفة الرفيق" : "Ready in the companion room",
                          body: ar ? "افتح الرفيق للصق الإشارة." : "Open the companion to paste the mention.",
                          tone: "success",
                        });
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    {ar ? "إلى الرفيق" : "To companion"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

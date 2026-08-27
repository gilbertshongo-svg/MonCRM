const GRAPH_API_VERSION = 'v20.0';

function isConfigured() {
  return Boolean(process.env.FACEBOOK_AD_ACCOUNT_ID && (process.env.FACEBOOK_ADS_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN));
}

function getToken() {
  return process.env.FACEBOOK_ADS_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
}

function getStatus() {
  return {
    configured: isConfigured(),
    adAccountId: process.env.FACEBOOK_AD_ACCOUNT_ID || null,
  };
}

function accountPath() {
  const id = process.env.FACEBOOK_AD_ACCOUNT_ID || '';
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function fetchInsights({ datePreset = 'last_30d' } = {}) {
  if (!isConfigured()) throw new Error('Statistiques publicitaires non configurées.');
  const fields = 'campaign_name,spend,impressions,clicks,ctr,cpc,actions';
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${accountPath()}/insights?level=campaign&date_preset=${datePreset}&fields=${fields}&access_token=${getToken()}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Échec de récupération des statistiques (${res.status}).`);

  const rows = (body.data || []).map((r) => {
    const results = (r.actions || []).reduce((sum, a) => sum + Number(a.value || 0), 0);
    return {
      campaignName: r.campaign_name,
      spend: Number(r.spend || 0),
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      ctr: Number(r.ctr || 0),
      cpc: Number(r.cpc || 0),
      results,
    };
  });

  const totals = rows.reduce((acc, r) => ({
    spend: acc.spend + r.spend,
    impressions: acc.impressions + r.impressions,
    clicks: acc.clicks + r.clicks,
    results: acc.results + r.results,
  }), { spend: 0, impressions: 0, clicks: 0, results: 0 });

  return { rows, totals, datePreset };
}

module.exports = { isConfigured, getStatus, fetchInsights };

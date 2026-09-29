// SPDX-License-Identifier: AGPL-3.0-or-later
// A-06 web component: <script src="https://<foundation>/embed/widget.js" async></script><gms-opportunities></gms-opportunities>
import { requireTenant } from '@/lib/tenant';

export async function GET() {
  const tenant = await requireTenant();
  const src = `${tenant.origin}/embed/opportunities`;
  const js = `(()=>{if(customElements.get('gms-opportunities'))return;
class GmsOpportunities extends HTMLElement{connectedCallback(){if(this.shadowRoot)return;const r=this.attachShadow({mode:'open'});
const f=document.createElement('iframe');f.src=${JSON.stringify(src)};f.title=${JSON.stringify(`Funding opportunities from ${tenant.brand.displayName}`)};
f.loading='lazy';f.style.cssText='width:100%;border:0;min-height:240px;display:block';r.appendChild(f);
window.addEventListener('message',e=>{if(e.origin!==${JSON.stringify(new URL(tenant.origin).origin)})return;const d=e.data;if(d&&d.type==='gms:embed-height'&&e.source===f.contentWindow)f.style.height=Math.min(4000,Math.max(120,d.height|0))+'px';});}}
customElements.define('gms-opportunities',GmsOpportunities);})();`;
  return new Response(js, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
}

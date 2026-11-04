import math
Y="#FFE600";W="#FFFFFF";MU="#C4C4CD";LN="#747480";P="#3A3A46";BG="#2E2E38"
o=[];a=o.append
a(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 700" width="1600" height="700" role="img" aria-label="Request routing using Ingress">
<defs><style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap');
.s{{font-family:'IBM Plex Sans',Arial,sans-serif}}.m{{font-family:'IBM Plex Mono',Consolas,monospace}}
</style>
<marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="{MU}"/></marker>
<marker id="ay" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="{Y}"/></marker>
</defs>
<rect width="1600" height="700" fill="{BG}"/>''')
a(f'<text x="24" y="330" class="s" fill="{W}" font-size="17" font-weight="600">Incoming Requests</text>')
a(f'<rect x="210" y="20" width="1375" height="625" rx="10" fill="none" stroke="{MU}" stroke-width="1.5" stroke-dasharray="8 6"/>')
a(f'<text x="234" y="50" class="m" fill="{MU}" font-size="13" letter-spacing="1.6">KUBERNETES CLUSTER</text>')
a(f'<rect x="234" y="70" width="636" height="555" rx="6" fill="{P}" stroke="{Y}" stroke-width="2"/>')
a(f'<text x="258" y="100" class="m" fill="{Y}" font-size="20" font-weight="500" letter-spacing="2.4">INGRESS</text>')
a(f'<text x="258" y="126" class="s" fill="{W}" font-size="16" font-weight="600">( Routing By Paths )</text>')
cx,cy,r=310,350,230
rows=[(170,"/Inventory/v1/Resource/devices","devices",2,False),(290,"/Inventory/v1/Resource/cards","cards",3,False),(410,"/Inventory/v1/Resource/ports","ports",1,False),(540,"/anything/other/than/above","legacy",2,True)]
active=170
a(f'<line x1="24" y1="{cy}" x2="{cx-16}" y2="{cy}" stroke="{Y}" stroke-width="2.5" marker-end="url(#ay)"/>')
xs=lambda y: cx+math.sqrt(r*r-(y-cy)**2)
a(f'<path d="M{xs(170):.1f} 170 A{r} {r} 0 0 1 {xs(540):.1f} 540" fill="none" stroke="{LN}" stroke-width="1.5" stroke-dasharray="3 5"/>')
for y,path,name,n,leg in rows:
    x=xs(y);act=(y==active);col=Y if act else MU
    a(f'<text x="{x+34:.1f}" y="{y-12}" class="m" fill="{W if act else MU}" font-size="15">{path}</text>')
    a(f'<line x1="{x+9:.1f}" y1="{y}" x2="896" y2="{y}" stroke="{col}" stroke-width="{2.5 if act else 1.5}" marker-end="url(#{"ay" if act else "ag"})"/>')
    a(f'<circle cx="{x:.1f}" cy="{y}" r="8" fill="{Y if act else BG}" stroke="{col}" stroke-width="2"/>')
    h=110 if leg else 84; ph=76 if leg else 54
    gs=Y if act else (MU if leg else LN)
    if leg:
        a(f'<rect x="900" y="{y-h/2}" width="665" height="{h}" rx="6" fill="{P}" stroke="{gs}" stroke-width="1.5"/>')
        a(f'<text x="920" y="{y-12}" class="m" fill="{MU}" font-size="12" letter-spacing="1.4">EXISTING APP</text>')
        a(f'<text x="920" y="{y+20}" class="s" fill="{W}" font-size="26" font-weight="600">Legacy Code</text>')
    else:
        a(f'<rect x="900" y="{y-h/2}" width="665" height="{h}" rx="6" fill="none" stroke="{gs}" stroke-width="{2 if act else 1.2}" stroke-dasharray="{"0" if act else "5 4"}"/>')
        a(f'<text x="920" y="{y-6}" class="m" fill="{MU}" font-size="12" letter-spacing="1.4">ECHO FLOW</text>')
        a(f'<text x="920" y="{y+18}" class="s" fill="{W}" font-size="19" font-weight="600">{name}</text>')
    for i in range(n):
        px=1100+i*155
        a(f'<rect x="{px}" y="{y-ph/2}" width="140" height="{ph}" rx="5" fill="{BG if leg else P}" stroke="{LN}"/>')
        a(f'<rect x="{px}" y="{y-ph/2}" width="6" height="{ph}" fill="{MU if leg else Y}"/>')
        a(f'<text x="{px+20}" y="{y-4}" class="m" fill="{MU}" font-size="11" letter-spacing="1.2">POD</text>')
        a(f'<text x="{px+20}" y="{y+16}" class="m" fill="{W}" font-size="14">{name}-{i+1}</text>')
ex,ey=xs(active),active
L=math.hypot(ex-cx,ey-cy);k=(L-12)/L
a(f'<line x1="{cx}" y1="{cy}" x2="{cx+(ex-cx)*k:.1f}" y2="{cy+(ey-cy)*k:.1f}" stroke="{Y}" stroke-width="7" stroke-linecap="round"/>')
a(f'<circle cx="{cx}" cy="{cy}" r="16" fill="{Y}"/><circle cx="{cx}" cy="{cy}" r="6" fill="{BG}"/>')
a(f'<text x="258" y="606" class="s" fill="{MU}" font-size="14">Each request takes one position, chosen by its path</text>')
a(f'<text x="24" y="682" class="s" fill="{MU}" font-size="14">ECHO adds Ingress rules only for its flows\' paths, so every other path still reaches the legacy application.</text>')
a('</svg>')
open(__import__('os').path.join(__import__('os').path.dirname(__file__),'ingress-routing.svg'),'w').write('\n'.join(o))

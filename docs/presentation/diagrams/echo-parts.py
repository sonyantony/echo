# Writes echo-parts.svg: the five parts of the ECHO platform, as used on slide 8.
import os
Y="#FFE600";W="#F2F2EE";MU="#C4C4CD";LN="#747480";P="#3A3A46";BG="#2E2E38";GREY="#6E6E7A"
WD,HT=1664,430
o=[];a=o.append
a(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WD} {HT}" width="{WD}" height="{HT}" role="img" aria-label="The five parts of ECHO">
<defs><style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap');
.s{{font-family:'IBM Plex Sans',Arial,sans-serif}}.m{{font-family:'IBM Plex Mono',Consolas,monospace}}
</style>
<marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="{MU}"/></marker>
</defs>
<rect width="{WD}" height="{HT}" fill="{BG}"/>''')
parts=[
 ("a","Builder Frontend",["Runs in the user's","browser: flows are","designed, tested and","published here."],"front",GREY),
 ("b","Builder Backend",["A Docker image running","Java 21 that serves the","front end. Not part of","the daily build and","deployment."],"server",GREY),
 ("c","Pipeline",["The scripts needed to","build the runtime flows","are provided."],"pipe",W),
 ("d","Kubernetes Ingress",["Configuration files"],"switch",W),
 ("e","ECHO Runtime",["Docker images running","Java 21 that contain the","flows. Bundle mode: all","flows in one image;","per-flow: one per flow."],"boxes",W),
]
bw,gap=290,51
top,bh=6,418
for k,(L,title,lines,icon,bar) in enumerate(parts):
    x=5+k*(bw+gap); cx=x+bw/2; cy=118
    a(f'<rect x="{x}" y="{top}" width="{bw}" height="{bh}" rx="6" fill="{P}" stroke="{LN}"/>')
    a(f'<rect x="{x}" y="{top}" width="{bw}" height="5" fill="{bar}"/>')
    a(f'<text x="{x+24}" y="{top+42}" class="m" fill="{MU}" font-size="20">{L}</text>')
    if icon=="front":
        a(f'<circle cx="{cx-62}" cy="{cy-8}" r="14" fill="{MU}"/>')
        a(f'<path d="M{cx-90} {cy+48} Q{cx-90} {cy+12} {cx-62} {cy+10} Q{cx-34} {cy+12} {cx-34} {cy+48} Z" fill="{MU}"/>')
        a(f'<rect x="{cx-22}" y="{cy-40}" width="108" height="72" rx="4" fill="{BG}" stroke="{MU}" stroke-width="2"/>')
        a(f'<rect x="{cx-10}" y="{cy-28}" width="18" height="12" rx="2" fill="{Y}"/><rect x="{cx+22}" y="{cy-10}" width="18" height="12" rx="2" fill="{MU}"/><rect x="{cx+54}" y="{cy+8}" width="18" height="12" rx="2" fill="{MU}"/>')
        a(f'<path d="M{cx+8} {cy-22} H{cx+14} V{cy-4} H{cx+22} M{cx+40} {cy-4} H{cx+46} V{cy+14} H{cx+54}" fill="none" stroke="{MU}" stroke-width="1.5"/>')
        a(f'<rect x="{cx+24}" y="{cy+32}" width="14" height="12" fill="{LN}"/><rect x="{cx+10}" y="{cy+44}" width="42" height="5" fill="{LN}"/>')
        a(f'<line x1="{cx-100}" y1="{cy+50}" x2="{cx+100}" y2="{cy+50}" stroke="{LN}" stroke-width="2"/>')
    elif icon=="server":
        for i in range(3):
            yy=cy-38+i*28
            a(f'<rect x="{cx-60}" y="{yy}" width="120" height="22" rx="3" fill="{BG}" stroke="{MU}" stroke-width="2"/>')
            a(f'<circle cx="{cx-44}" cy="{yy+11}" r="3.5" fill="{Y if i==0 else MU}"/><line x1="{cx-28}" y1="{yy+11}" x2="{cx+44}" y2="{yy+11}" stroke="{LN}" stroke-width="2"/>')
    elif icon=="pipe":
        for i in range(3):
            xx=cx-56+i*38
            a(f'<path d="M{xx} {cy-30} L{xx+28} {cy} L{xx} {cy+30}" fill="none" stroke="{Y if i==2 else MU}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>')
    elif icon=="switch":
        px,py=cx-50,cy
        for dy in (-34,0,34):
            a(f'<circle cx="{cx+40}" cy="{cy+dy}" r="6" fill="{BG}" stroke="{MU}" stroke-width="2"/><line x1="{cx+46}" y1="{cy+dy}" x2="{cx+70}" y2="{cy+dy}" stroke="{MU}" stroke-width="2"/>')
        a(f'<line x1="{px-30}" y1="{py}" x2="{px}" y2="{py}" stroke="{MU}" stroke-width="2"/>')
        a(f'<line x1="{px}" y1="{py}" x2="{cx+34}" y2="{cy-31}" stroke="{Y}" stroke-width="6" stroke-linecap="round"/>')
        a(f'<circle cx="{px}" cy="{py}" r="9" fill="{Y}"/>')
    elif icon=="boxes":
        for i in range(3):
            xx=cx-66+i*46
            a(f'<rect x="{xx}" y="{cy-22}" width="40" height="44" rx="3" fill="{BG}" stroke="{MU}" stroke-width="2"/><rect x="{xx}" y="{cy-22}" width="5" height="44" fill="{Y}"/>')
    a(f'<text x="{x+24}" y="{top+226}" class="s" fill="{W}" font-size="27" font-weight="600">{title}</text>')
    for j,ln in enumerate(lines):
        a(f'<text x="{x+24}" y="{top+266+j*29}" class="s" fill="#D6D6DC" font-size="20">{ln.replace("&","&amp;").replace("\'","&#8217;")}</text>')
    if k<4:
        a(f'<line x1="{x+bw+8}" y1="{top+118}" x2="{x+bw+gap-8}" y2="{top+118}" stroke="{MU}" stroke-width="2" marker-end="url(#ag)"/>')
a('</svg>')
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'echo-parts.svg'),'w').write('\n'.join(o))

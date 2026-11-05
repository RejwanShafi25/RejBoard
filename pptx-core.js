/* PowerPoint (.pptx) writer for RejBoard exports: one slide per page, each slide one full-bleed picture of that page.
   Pure functions, no DOM: build() returns zip entries ({path, text|bytes}) for MdCore.zip, so Node tests can check the package. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PptxCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const EMU = 9525; /* EMU per CSS pixel (914400 per inch at 96 dpi) */
  const MIN = 914400, MAX = 51206400; /* PowerPoint's slide size limits (1 in .. 56 in) */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  /* the slide size: the first slide's shape, scaled so its long side is 13.33 in (a widescreen slide's width), inside PowerPoint's limits */
  function slideSize(w, h) {
    w = Math.max(1, +w || 1); h = Math.max(1, +h || 1);
    const k = 12192000 / Math.max(w, h);
    let cx = Math.round(w * k), cy = Math.round(h * k);
    if (cx < MIN) { cy = Math.round(cy * MIN / cx); cx = MIN; } if (cy < MIN) { cx = Math.round(cx * MIN / cy); cy = MIN; }
    return { cx: Math.min(MAX, cx), cy: Math.min(MAX, cy) };
  }
  /* a picture of w x h fitted into the slide, centred (letterboxed when its shape differs) */
  function fit(w, h, S) { const k = Math.min(S.cx / w, S.cy / h), cx = Math.round(w * k), cy = Math.round(h * k); return { x: Math.round((S.cx - cx) / 2), y: Math.round((S.cy - cy) / 2), cx, cy }; }

  const theme = () => X + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="RejBoard"><a:themeElements>
<a:clrScheme name="RejBoard"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1B16"/></a:dk2><a:lt2><a:srgbClr val="F3ECDF"/></a:lt2>
<a:accent1><a:srgbClr val="6C63B5"/></a:accent1><a:accent2><a:srgbClr val="F5A3C0"/></a:accent2><a:accent3><a:srgbClr val="8FD6CB"/></a:accent3><a:accent4><a:srgbClr val="F6D26A"/></a:accent4><a:accent5><a:srgbClr val="9CC6F0"/></a:accent5><a:accent6><a:srgbClr val="F29B7C"/></a:accent6>
<a:hlink><a:srgbClr val="2B6CDF"/></a:hlink><a:folHlink><a:srgbClr val="6C63B5"/></a:folHlink></a:clrScheme>
<a:fontScheme name="RejBoard"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="RejBoard"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
  const master = () => X + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
  const layout = () => X + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const slide = (n, f, name) => X + `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:pic><p:nvPicPr><p:cNvPr id="2" name="${esc(name)}" descr="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${f.x}" y="${f.y}"/><a:ext cx="${f.cx}" cy="${f.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const rels = list => X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

  /* o: {title, slides:[{png: Uint8Array, w, h}], when?: Date} -> zip entries */
  function build(o) {
    const slides = (o && o.slides || []).filter(s => s && s.png && s.png.length);
    if (!slides.length) throw new Error('nothing to export');
    const title = String(o.title || 'Untitled'), S = slideSize(slides[0].w, slides[0].h), when = (o.when instanceof Date ? o.when : new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
    const n = slides.length, idx = Array.from({ length: n }, (_, i) => i + 1), E = [];
    E.push({ path: '[Content_Types].xml', text: X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${idx.map(i => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>` });
    E.push({ path: '_rels/.rels', text: X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` });
    E.push({ path: 'docProps/core.xml', text: X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>RejBoard</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>` });
    E.push({ path: 'docProps/app.xml', text: X + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>RejBoard</Application><Slides>${n}</Slides></Properties>` });
    E.push({ path: 'ppt/presentation.xml', text: X + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${idx.map(i => `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${S.cx}" cy="${S.cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>` });
    E.push({ path: 'ppt/_rels/presentation.xml.rels', text: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...idx.map(i => ['rId' + (i + 1), 'slide', `slides/slide${i}.xml`]), ['rId' + (n + 2), 'presProps', 'presProps.xml'], ['rId' + (n + 3), 'viewProps', 'viewProps.xml'], ['rId' + (n + 4), 'theme', 'theme/theme1.xml'], ['rId' + (n + 5), 'tableStyles', 'tableStyles.xml']]) });
    E.push({ path: 'ppt/presProps.xml', text: X + `<p:presentationPr ${NS}/>` });
    E.push({ path: 'ppt/viewProps.xml', text: X + `<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` });
    E.push({ path: 'ppt/tableStyles.xml', text: X + `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` });
    E.push({ path: 'ppt/theme/theme1.xml', text: theme() });
    E.push({ path: 'ppt/slideMasters/slideMaster1.xml', text: master() });
    E.push({ path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', text: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) });
    E.push({ path: 'ppt/slideLayouts/slideLayout1.xml', text: layout() });
    E.push({ path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', text: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) });
    slides.forEach((s, k) => {
      const i = k + 1;
      E.push({ path: `ppt/slides/slide${i}.xml`, text: slide(i, fit(s.w, s.h, S), n > 1 ? `${title} — page ${i}` : title) });
      E.push({ path: `ppt/slides/_rels/slide${i}.xml.rels`, text: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/image${i}.png`]]) });
      E.push({ path: `ppt/media/image${i}.png`, bytes: s.png });
    });
    return E;
  }
  return { build, slideSize, fit, esc };
});

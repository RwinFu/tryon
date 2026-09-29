/**
 * کاتالوگ مرجعِ محصولات عینک: نام و کدِ مدل‌های واقعی، اندازهٔ چاپی و پیوند منبع.
 *
 * important: برای این اقلام فایلِ 3D رسمی در مخزن نداریم. هندسهٔ فعلی یک
 * پیش‌نمایشِ رویه‌ایِ سایزدار از روی سیلوئت/ابعاد است، نه اسکن یا مدل رسمیِ
 * Ray-Ban / Police / Cartier / Chrome Hearts. برای انطباقِ دقیق باید GLB مجازِ
 * همان SKU در فیلد glb محصولات قرار گیرد.
 */

/** @typedef {{name:string,color:string,finish?:string,metalColor?:string,lens?:string|object,translucent?:number,accentColor?:string}} Variant */

const sourceNames = {
  manufacturer: "صفحهٔ سازنده",
  retailer: "فروشندهٔ تخصصی",
};

function frame({
  id,
  brand,
  name,
  modelCode,
  sku,
  size,
  shape,
  style = "full",
  material = "acetate",
  composition,
  lensH,
  lensHSource = "manufacturer",
  finish,
  color,
  colorName,
  metalColor,
  accentColor,
  metalTint,
  lens = "clear",
  sourceUrl,
  sourceType = "manufacturer",
  sourceNote,
  modelAssetStatus = "procedural-preview",
  modelAssetNote = "هندسهٔ پیش‌نمایش؛ مدل رسمی/اسکنِ همان SKU نیست.",
  modelAssetSource,
  modelAssetLicense,
  modelAssetAttribution,
  glb,
  glbOffset,
  glbRotation,
  glbScale,
  widthMM,
  gender = "unisex",
  tags = [],
  bestFor = ["oval", "round", "square"],
  geom = {},
}) {
  const [lensW, dbn, templeLen] = String(size).split(/[^0-9.]+/).filter(Boolean).map(Number);
  const variant = { name: colorName || "رنگ مرجع", color, finish, metalColor, accentColor, lens };
  if (metalTint) variant.metalTint = metalTint;
  return {
    id: `AR-${id}`,
    sku,
    name,
    brand,
    modelCode,
    modelFamily: name,
    size,
    shape,
    style,
    material,
    composition: composition || material,
    lensH,
    lensHSource,
    finish,
    color,
    metalColor,
    accentColor,
    metalTint,
    lens,
    gender,
    tags: [...tags, shape],
    bestFor,
    sourceUrl,
    url: sourceUrl,
    sourceName: sourceNames[sourceType],
    sourceType,
    sourceNote,
    sourceChecked: "2026-09-29",
    modelAssetStatus,
    modelAssetNote,
    modelAssetSource,
    modelAssetLicense,
    modelAssetAttribution,
    glb,
    glbOffset,
    glbRotation,
    glbScale,
    widthMM,
    colors: [variant],
    ...geom,
    spec: {
      shape,
      style,
      material,
      lensW,
      dbn,
      templeLen,
      lensH,
      finish,
      color,
      lens,
      metalColor,
      metalTint,
      ...geom,
    },
  };
}

export const CATALOG = [
  // Ray-Ban — مدل/کد/ابعاد از صفحات رسمی Ray-Ban.
  frame({ id: 101, brand: "Ray-Ban", name: "Original Wayfarer Classic", modelCode: "RB2140 901/58", sku: "RB2140-901-58-50", size: "50□22-150", shape: "wayfarer", material: "acetate", composition: "Acetate", lensH: 41, finish: "polished-black", color: "#111216", colorName: "مشکی براق · G-15 سبز", lens: { type: "solid", color: "#52645a", tint: 0.74 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB2140%20UNISEX%20original%20wayfarer%20classic-black/805289126577", tags: ["ray-ban", "sun", "iconic"], bestFor: ["round", "oval", "heart"], geom: { rimW: 5.2, rimT: 4.0, pantoDeg: 7, bridgeDrop: 0.46, baseCurve: 6.5 } }),
  frame({ id: 102, brand: "Ray-Ban", name: "Original Wayfarer Classic", modelCode: "RB2140 902/51", sku: "RB2140-902-51-50", size: "50□22-150", shape: "wayfarer", material: "acetate", composition: "Acetate", lensH: 41, finish: "havana", color: "#754626", colorName: "لاک‌پشتی براق · قهوه‌ای روشن", lens: { type: "solid", color: "#6b4a37", tint: 0.5 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB2140%20UNISEX%20original%20wayfarer%20classic-tortoise/805289183082", tags: ["ray-ban", "sun", "iconic"], bestFor: ["round", "oval", "heart"], geom: { rimW: 5.2, rimT: 4.0, pantoDeg: 7, bridgeDrop: 0.46, baseCurve: 6.5 } }),
  frame({ id: 103, brand: "Ray-Ban", name: "Aviator Classic", modelCode: "RB3025 002/58", sku: "RB3025-002-58-62", size: "62□14-140", shape: "aviator", material: "metal", composition: "Metal", lensH: 54.2, finish: "gunmetal-polish", metalColor: "#24272c", color: "#24272c", colorName: "مشکی پولیش · سبز پلاریزه", lens: { type: "solid", color: "#53645b", tint: 0.74 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB3025%20UNISEX%20aviator%20classic-black/805289115700", tags: ["ray-ban", "sun", "pilot", "double-bridge"], bestFor: ["square", "round", "oblong"], geom: { metalRimW: 1.55, metalRimT: 1.2, doubleBridge: true, nosePads: true, highBridge: true, teardrop: 0.34, topWide: 1.08, pantoDeg: 6, templeW: 2.3, templeT: 1.4, baseCurve: 6 } }),
  frame({ id: 104, brand: "Ray-Ban", name: "Round Metal", modelCode: "RB3447 029", sku: "RB3447-029-50", size: "50□21-145", shape: "roundmetal", material: "metal", composition: "Metal", lensH: 46.9, finish: "gunmetal", metalColor: "#5c646d", color: "#5c646d", colorName: "گان‌متال مات · G-15 سبز", lens: { type: "solid", color: "#53645b", tint: 0.72 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB3447%20UNISEX%20round%20metal-gunmetal/805289439936", tags: ["ray-ban", "sun", "round"], bestFor: ["square", "oblong", "diamond"], geom: { metalRimW: 1.4, metalRimT: 1.15, nosePads: true, pantoDeg: 8, templeW: 2.0, templeT: 1.4, baseCurve: 5.5 } }),
  frame({ id: 105, brand: "Ray-Ban", name: "Round Metal", modelCode: "RB3447 112/58", sku: "RB3447-112-58-50", size: "50□21-145", shape: "roundmetal", material: "metal", composition: "Metal", lensH: 46.9, finish: "gold", metalColor: "#c6a25b", color: "#c6a25b", colorName: "طلایی مات · G-15 سبز پلاریزه", lens: { type: "solid", color: "#53645b", tint: 0.72 }, sourceUrl: "https://www.ray-ban.com/mea/sunglasses/RB3447%20UNISEX%20round%20metal-gold/8053672416107", tags: ["ray-ban", "sun", "round"], bestFor: ["square", "oblong", "diamond"], geom: { metalRimW: 1.4, metalRimT: 1.15, nosePads: true, pantoDeg: 8, templeW: 2.0, templeT: 1.4, baseCurve: 5.5 } }),
  frame({ id: 106, brand: "Ray-Ban", name: "Clubmaster Classic", modelCode: "RB3016 901/58", sku: "RB3016-901-58-55", size: "55□21-150", shape: "browline", style: "brow", material: "acetate", composition: "Acetate / metal", lensH: 47.5, finish: "polished-black", color: "#141518", metalColor: "#b89a63", metalTint: "gold", colorName: "مشکی/طلایی · G-15 سبز پلاریزه", lens: { type: "solid", color: "#526159", tint: 0.73 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB3016%20UNISEX%20clubmaster%20classic-black%20on%20gold/8056597847889", tags: ["ray-ban", "sun", "browline", "classic"], bestFor: ["round", "triangle", "oval"], geom: { rimW: 5.0, rimT: 3.3, metalRimW: 1.55, metalRimT: 1.2, browMaterial: "metal", bridgeMaterial: "metal", templeMaterial: "metal", nosePads: true, bridgeDrop: 0.42, pantoDeg: 7 } }),
  frame({ id: 107, brand: "Ray-Ban", name: "Clubmaster Classic", modelCode: "RB3016 130933", sku: "RB3016-130933-49", size: "49□21-140", shape: "browline", style: "brow", material: "acetate", composition: "Acetate / metal", lensH: 42.3, finish: "havana", color: "#6b4329", metalColor: "#b89a63", metalTint: "gold", colorName: "هاوانا براق · قهوه‌ای B-15", lens: { type: "solid", color: "#6b4a36", tint: 0.5 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB3016%20UNISEX%20clubmaster%20classic-havana/8056597260282", tags: ["ray-ban", "sun", "browline", "classic"], bestFor: ["round", "triangle", "oval"], geom: { rimW: 4.8, rimT: 3.1, metalRimW: 1.5, metalRimT: 1.2, browMaterial: "metal", bridgeMaterial: "metal", templeMaterial: "metal", nosePads: true, bridgeDrop: 0.42, pantoDeg: 7 } }),
  frame({ id: 108, brand: "Ray-Ban", name: "Erika Classic", modelCode: "RB4171 865/13", sku: "RB4171-865-13-54", size: "54□18-145", shape: "panto", material: "acetate", composition: "Injected frame", lensH: 46, finish: "matte-tortoise", color: "#7b5a3d", colorName: "هاوانا مات · قهوه‌ای", lens: { type: "gradient", color: "#755947", tint: 0.56 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB4171%20UNISEX%20017-erika%20classic-tortoise/805289742470", tags: ["ray-ban", "sun", "panto"], bestFor: ["square", "oblong", "diamond"], geom: { rimW: 4.35, rimT: 3.15, pantoDeg: 8, topFlatten: 0.14, bridgeDrop: 0.45, baseCurve: 6 } }),
  frame({ id: 109, brand: "Ray-Ban", name: "RB2180", modelCode: "RB2180 710/73", sku: "RB2180-710-73-49", size: "49□21-145", shape: "round", material: "acetate", composition: "Injected frame", lensH: 47.4, finish: "havana", color: "#8a6443", colorName: "هاوانا روشن · قهوه‌ای B-15", lens: { type: "solid", color: "#70513e", tint: 0.56 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB2180%20UNISEX%20rb2180-light%20havana/8053672358612", tags: ["ray-ban", "sun", "round"], bestFor: ["square", "oblong", "diamond"], geom: { rimW: 4.7, rimT: 3.2, pantoDeg: 5, bridgeDrop: 0.43 } }),
  frame({ id: 110, brand: "Ray-Ban", name: "Wayfarer Ease", modelCode: "RB4340 710", sku: "RB4340-710-50", size: "50□22-150", shape: "wayfarer", material: "acetate", composition: "Injected frame", lensH: 41, finish: "havana", color: "#9a734e", colorName: "هاوانا روشن · G-15 سبز", lens: { type: "solid", color: "#53645b", tint: 0.72 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB4340%20UNISEX%20P004-wayfarer%20ease-tortoise/8053672770438", tags: ["ray-ban", "sun", "wayfarer"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.65, rimT: 3.4, pantoDeg: 5, bridgeDrop: 0.46, baseCurve: 6 } }),
  frame({ id: 111, brand: "Ray-Ban", name: "New Wayfarer Classic", modelCode: "RB2132 901/58", sku: "RB2132-901-58-55", size: "55□18-145", shape: "wayfarer", material: "acetate", composition: "Nylon frame", lensH: 40.8, finish: "polished-black", color: "#111216", colorName: "مشکی براق · G-15 سبز پلاریزه", lens: { type: "solid", color: "#52645a", tint: 0.74 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB2132%20UNISEX%20new%20wayfarer%20classic-black/805289083078", tags: ["ray-ban", "sun", "wayfarer"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.7, rimT: 3.45, pantoDeg: 5, bridgeDrop: 0.43, topFlatten: 0.05, baseCurve: 6 } }),
  frame({ id: 112, brand: "Ray-Ban", name: "Erika Classic Exclusive", modelCode: "RB4171 63254L", sku: "RB4171-63254L-54", size: "54□18-145", shape: "panto", material: "acetate", composition: "Nylon frame", lensH: 46, finish: "crystal", color: "#777e83", colorName: "شفاف خاکستری · آبی گرادیان", lens: { type: "gradient", color: "#536d84", tint: 0.51 }, sourceUrl: "https://www.ray-ban.com/usa/sunglasses/RB4171%20FEMALE%20erika%20classic%20exclusive-transparent/8056597539487", tags: ["ray-ban", "sun", "panto"], bestFor: ["square", "oblong", "diamond"], geom: { rimW: 4.35, rimT: 3.15, pantoDeg: 8, topFlatten: 0.14, bridgeDrop: 0.45, baseCurve: 6 } }),

  // Police — اندازه/کد از صفحات رسمی Police؛ ارتفاع عدسیِ درج‌نشده تخمین هندسی است.
  frame({ id: 113, brand: "Police", name: "Origins 33", modelCode: "VPLB76 530700", sku: "VPLB76-530700", size: "53□19-145", shape: "panto", material: "acetate", composition: "Acetate / metal", lensH: 43, lensHSource: "estimated", finish: "polished-black", color: "#131519", metalColor: "#b8b9ba", colorName: "مشکی براق / جزئیات فلزی", sourceUrl: "https://policelifestyle.com/uk-en/origins-33-man-eyeglasses-police-vplb76-p", tags: ["police", "optical", "origins"], bestFor: ["square", "oblong", "diamond"], geom: { rimW: 4.7, rimT: 3.35, templeMaterial: "metal", metalRimW: 1.5, metalRimT: 1.2, bridgeDrop: 0.45, pantoDeg: 8 } }),
  frame({ id: 114, brand: "Police", name: "Origins 23", modelCode: "VPLA48 530700", sku: "VPLA48-530700", size: "53□21-145", shape: "square", material: "acetate", composition: "Acetate / metal", lensH: 43, lensHSource: "estimated", finish: "polished-black", color: "#14161a", metalColor: "#9c8150", colorName: "مشکی براق / طلایی", sourceUrl: "https://policelifestyle.com/sl-en/origins-23-man-eyeglasses-police-vpla48-p", tags: ["police", "optical", "origins"], bestFor: ["round", "oval", "heart"], geom: { rimW: 5.0, rimT: 3.8, templeMaterial: "metal", bridgeDrop: 0.47, pantoDeg: 5 } }),
  frame({ id: 115, brand: "Police", name: "Zenith 3", modelCode: "VPLD09 5807GN", sku: "VPLD09-5807GN", size: "58□14-145", shape: "square", material: "acetate", composition: "Injected frame / metal", lensH: 42, lensHSource: "estimated", finish: "translucent-amber", color: "#83634c", metalColor: "#44484b", colorName: "قهوه‌ای شفاف", sourceUrl: "https://policelifestyle.com/sl-en/zenith-3-man-eyeglasses-police-vpld09-p", tags: ["police", "optical", "sport"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.3, rimT: 3.1, templeMaterial: "metal", topWide: 1.03, pantoDeg: 4 } }),
  frame({ id: 116, brand: "Police", name: "Champ 3", modelCode: "VPLG74 534G0Y", sku: "VPLG74-534G0Y", size: "53□17-145", shape: "aviator", material: "acetate", composition: "Acetate", lensH: 43, lensHSource: "estimated", finish: "crystal", color: "#747b7c", colorName: "خاکستری شفاف", sourceUrl: "https://policelifestyle.com/ww-en/champ-3-man-eyeglasses-police-vplg74-p", tags: ["police", "optical", "aviator"], bestFor: ["square", "round", "oblong"], geom: { rimW: 4.35, rimT: 3.1, topWide: 1.02, teardrop: 0.19, bridgeDrop: 0.4 } }),
  frame({ id: 117, brand: "Police", name: "Origins Lite 22", modelCode: "VPLN17 5403GU", sku: "VPLN17-5403GU", size: "54□17-145", shape: "square", material: "acetate", composition: "Acetate", lensH: 40, lensHSource: "estimated", finish: "crystal", color: "#9da2a4", colorName: "خاکستری روشن شفاف", sourceUrl: "https://policelifestyle.com/pl-en/origins-lite-22-man-eyeglasses-police-vpln17-p", tags: ["police", "optical", "origins-lite"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.25, rimT: 3.0, pantoDeg: 4 } }),
  frame({ id: 118, brand: "Police", name: "Origins Lite 28", modelCode: "VPLP10 540509", sku: "VPLP10-540509", size: "54□19-145", shape: "hexagon", material: "metal", composition: "Metal / injected", lensH: 44, lensHSource: "estimated", finish: "gunmetal", metalColor: "#777d82", color: "#777d82", colorName: "روثنیوم براق", sourceUrl: "https://policelifestyle.com/ww-en/origins-lite-28-man-eyeglasses-police-vplp10-vplp10540509-p", tags: ["police", "optical", "hexagonal"], bestFor: ["round", "oval", "heart"], geom: { metalRimW: 1.55, metalRimT: 1.25, nosePads: true, hexBlend: 0.58, hexSides: 6, templeW: 2.0, templeT: 1.4, templeMaterial: "acetate", endpieceMaterial: "metal" } }),
  frame({ id: 119, brand: "Police", name: "Supernova 7", modelCode: "VPLR65 510706", sku: "VPLR65-510706", size: "51□19-150", shape: "panto", material: "acetate", composition: "Acetate", lensH: 43, lensHSource: "estimated", finish: "havana", color: "#755233", colorName: "هاوانا متوسط براق", sourceUrl: "https://policelifestyle.com/ww-en/supernova-7-man-eyeglasses-police-vplr65-vplr65510706-p?variant=VPLR65+510706", tags: ["police", "optical", "panto"], bestFor: ["square", "oblong", "diamond"], geom: { rimW: 4.8, rimT: 3.65, pantoDeg: 9, bridgeDrop: 0.46 } }),

  // Cartier — مرجع و اعداد از صفحات رسمی Cartier؛ بعضی ارتفاع‌ها در صفحه منتشر نشده‌اند.
  frame({ id: 120, brand: "Cartier", name: "Santos de Cartier Rimless", modelCode: "CRESW00676", sku: "CRESW00676", size: "56□20-145", shape: "rectangle", style: "rimless", material: "metal", composition: "Rimless metal", lensH: 39, lensHSource: "estimated", finish: "gold", metalColor: "#c9a85e", color: "#c9a85e", colorName: "طلایی برس‌خورده · خاکستری", lens: { type: "solid", color: "#697077", tint: 0.68 }, sourceUrl: "https://www.cartier.com/en-se/bags-and-accessories/sunglasses/santos-de-cartier/santos-de-cartier-sunglasses-CRESW00676", tags: ["cartier", "sun", "rimless", "santos"], bestFor: ["round", "oval", "heart"], geom: { metalRimW: 1.3, metalRimT: 1.05, nosePads: true, rimlessMounts: true, bridgeDrop: 0.45, templeW: 2.2, templeT: 1.5 } }),
  frame({ id: 121, brand: "Cartier", name: "Panthère de Cartier Cat-Eye Rimless", modelCode: "CRESW00660", sku: "CRESW00660", size: "61□15-140", shape: "cateye", style: "rimless", material: "metal", composition: "Rimless metal", lensH: 50, lensHSource: "estimated", finish: "gold", metalColor: "#c9a85e", color: "#c9a85e", colorName: "طلایی / عدسی قهوه‌ای گرادیان", lens: { type: "gradient", color: "#765744", tint: 0.58 }, sourceUrl: "https://www.cartier.com/en-us/bags-and-accessories/sunglasses/panthere-de-cartier/panthere-de-cartier-sunglasses-CRESW00660.html", tags: ["cartier", "sun", "rimless", "cat-eye", "panthere"], bestFor: ["round", "square", "oval"], geom: { metalRimW: 1.25, metalRimT: 1.0, nosePads: true, rimlessMounts: true, catAmp: 0.3, catWidth: 0.38, templeW: 2.2, templeT: 1.5 } }),
  frame({ id: 122, brand: "Cartier", name: "Panthère de Cartier", modelCode: "CRESW00686", sku: "CRESW00686", size: "56□18-145", shape: "rectangle", style: "rimless", material: "metal", composition: "Rimless metal", lensH: 40, lensHSource: "estimated", finish: "gold", metalColor: "#c9a85e", color: "#c9a85e", colorName: "طلایی / عدسی خاکستری آینه‌ای", lens: { type: "mirror", color: "#a78b62", tint: 0.66 }, sourceUrl: "https://www.cartier.com/en-gb/bags-and-accessories/sunglasses/panthere-de-cartier/panthere-de-cartier-sunglasses-CRESW00686", tags: ["cartier", "sun", "rimless", "panthere"], bestFor: ["round", "oval", "heart"], geom: { metalRimW: 1.25, metalRimT: 1.0, nosePads: true, rimlessMounts: true, templeW: 2.2, templeT: 1.5 } }),
  frame({ id: 123, brand: "Cartier", name: "C de Cartier Signature", modelCode: "CRESW00404", sku: "CRESW00404", size: "54□21-145", shape: "rectangle", material: "metal", composition: "Black PVD metal front / acetate temples", lensH: 39, lensHSource: "estimated", finish: "polished-black", color: "#18191c", metalColor: "#3b3b3e", metalTint: "gold", colorName: "مشکی PVD / پل طلایی · خاکستری تیره", lens: { type: "solid", color: "#61646a", tint: 0.72 }, sourceUrl: "https://www.cartier.com/en-gb/bags-and-accessories/sunglasses/signature-c-de-cartier/c-de-cartier-signature-sunglasses-CRESW00404", tags: ["cartier", "sun", "double-bridge", "signature-c"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.2, rimT: 3.0, metalRimW: 1.4, metalRimT: 1.2, bridgeMaterial: "accent", templeMaterial: "acetate", endpieceMaterial: "metal", doubleBridge: true, nosePads: true, pantoDeg: 2 } }),
  frame({ id: 124, brand: "Cartier", name: "Première de Cartier", modelCode: "CRESW00628", sku: "CRESW00628", size: "53□20-145", shape: "rectangle", material: "acetate", composition: "Black composite", lensH: 40, lensHSource: "estimated", finish: "polished-black", color: "#151619", colorName: "مشکی / عدسی خاکستری", lens: { type: "solid", color: "#64676c", tint: 0.66 }, sourceUrl: "https://www.cartier.com/en-gb/bags-and-accessories/sunglasses/premiere-de-cartier/premiere-de-cartier-sunglasses-CRESW00628", tags: ["cartier", "sun", "premiere"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.6, rimT: 3.5, pantoDeg: 3, bridgeDrop: 0.42 } }),
  frame({ id: 125, brand: "Cartier", name: "Santos de Cartier Titanium", modelCode: "CRESW00792", sku: "CRESW00792", size: "54□21-145", shape: "square", material: "metal", composition: "Titanium rim / metal", lensH: 40, lensHSource: "estimated", finish: "gold", metalColor: "#bd9a58", color: "#bd9a58", colorName: "طلایی برس‌خورده · سبز پلاریزه", lens: { type: "solid", color: "#526359", tint: 0.75 }, sourceUrl: "https://www.cartier.com/en-lv/bags-and-accessories/sunglasses/santos-de-cartier/santos-de-cartier-sunglasses-CRESW00792", tags: ["cartier", "sun", "santos"], bestFor: ["round", "oval", "heart"], geom: { metalRimW: 1.65, metalRimT: 1.3, nosePads: true, bridgeDrop: 0.45, pantoDeg: 4 } }),

  // Chrome Hearts — مدل و اندازه از فهرست‌های خرده‌فروشی؛ منبع رسمی 3D در دسترس نیست.
  frame({ id: 126, brand: "Chrome Hearts", name: "Bonennoisseur II", modelCode: "BONENNOISSEUR II BK/BS", sku: "CH-BONENNOISSEUR-II-BK-BS-53", size: "53□19-150", shape: "square", material: "acetate", composition: "Acetate / titanium / sterling silver", lensH: 41, lensHSource: "estimated", finish: "polished-black", color: "#151619", metalColor: "#9b9b9c", accentColor: "#b9b9b5", colorName: "مشکی / نقره‌ای برس‌خورده", sourceType: "retailer", sourceUrl: "https://modesens.com/product/chrome-hearts-bonennoisseur-ii---black-brushed-silver-glasses-64031349/", sourceNote: "منبع، مشخصات و سایز 53-19-150 را فهرست می‌کند؛ ارتفاع عدسی در منبع نیست و تخمینی است.", tags: ["chrome-hearts", "optical", "combination"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.8, rimT: 3.4, metalRimW: 1.5, metalRimT: 1.2, templeMaterial: "metal", bridgeMaterial: "metal", nosePads: true, pantoDeg: 3 } }),
  frame({ id: 127, brand: "Chrome Hearts", name: "Gittin Any?", modelCode: "GITTIN ANY?", sku: "CH-GITTIN-ANY-52-19-145", size: "52□19-145", shape: "square", material: "acetate", composition: "Acetate / silver hardware", lensH: 41, lensHSource: "estimated", finish: "polished-black", color: "#141519", metalColor: "#c3a05e", accentColor: "#c3a05e", colorName: "مشکی / طلایی plated", sourceType: "retailer", sourceUrl: "https://modesens.com/product/chrome-hearts-gittin-any-blackgoldplated-107182274/", sourceNote: "فهرست فروشندهٔ کالای کلکسیونی برای رنگ مشکی/طلایی و سایز 52-19-145؛ موجودی و اصالت از این برنامه تأیید نمی‌شود.", tags: ["chrome-hearts", "optical", "square"], bestFor: ["round", "oval", "heart"], geom: { rimW: 5.0, rimT: 3.8, templeMaterial: "metal", bridgeDrop: 0.43, pantoDeg: 4 } }),
  frame({ id: 128, brand: "Chrome Hearts", name: "Vagilante", modelCode: "VAGILANTE BK/GP", sku: "CH-VAGILANTE-BK-GP-54", size: "54□19-149", shape: "rectangle", material: "acetate", composition: "Acetate / metal hardware", lensH: 38, lensHSource: "estimated", finish: "polished-black", color: "#151619", metalColor: "#c3a05e", accentColor: "#c3a05e", colorName: "مشکی / طلایی", sourceType: "retailer", sourceUrl: "https://modesens.com/product/chrome-hearts-vagilante-glasses-blackgold-plated-107379731/", sourceNote: "فهرست فروشنده برای Vagilante رنگ مشکی/طلایی و سایز 54-19-149؛ ارتفاع عدسی تخمینی است.", tags: ["chrome-hearts", "optical", "rectangular"], bestFor: ["round", "oval", "heart"], geom: { rimW: 4.6, rimT: 3.6, templeMaterial: "metal", bridgeDrop: 0.4, pantoDeg: 2 } }),
];

/** شکل‌های صورت که در موتور پیشنهاد استفاده می‌شوند. */
export const FACE_SHAPES = {
  oblong: { label: "کشیده (مستطیلی)" },
  round: { label: "گرد" },
  square: { label: "مربعی" },
  oval: { label: "بیضی" },
  heart: { label: "قلبی" },
  diamond: { label: "الماسی" },
  triangle: { label: "مثلثی" },
};

for (const p of CATALOG) {
  if (!p.gender) p.gender = (p.tags || []).includes("women") ? "female" : (p.tags || []).includes("men") ? "male" : "unisex";
}

export const CATALOG_BY_ID = new Map(CATALOG.map((p) => [String(p.id), p]));

/** نرمال‌سازی محصول → spec هندسه + متریال (فیلدهای اختصاصی محصول حفظ می‌شوند). */
export function toEngineSpec(product) {
  const sizeParts = String(product.size || "")
    .split(/[^0-9.]+/)
    .filter(Boolean)
    .map(Number);
  const spec = {
    shape: product.shape || "square",
    style: product.style || "full",
    material: product.material || "acetate",
    lensW: sizeParts[0] || product.lensW || 52,
    dbn: sizeParts[1] || product.dbn || 18,
    templeLen: sizeParts[2] || product.templeLen || 145,
    lensH: product.lensH || undefined,
    finish: product.finish,
    color: product.color,
    metalColor: product.metalColor,
    metalTint: product.metalTint,
    ...product.spec,
  };
  for (const k of [
    "rimW", "rimT", "bevel", "pantoDeg", "splayDeg", "templeW", "templeT", "templeTaper",
    "earDrop", "metalRimW", "metalRimT", "doubleBridge", "highBridge", "nosePads", "bridgeDrop",
    "bridgeArch", "baseCurve", "catAmp", "catWidth", "teardrop", "exp", "depth", "topFlatten",
    "nasalNotch", "topWide", "hexBlend", "hexSides", "lensTiltDeg", "lensPath", "lensPathL", "lensPathR",
    "hinge", "endpiece", "endpieceMaterial", "earBendAt", "lensInset", "bridgeStyle", "bridgeMaterial", "browMaterial",
    "templeMaterial", "rimlessMounts", "profile",
  ]) if (product[k] !== undefined) spec[k] = product[k];
  return spec;
}

/** «52□18-145» → { lensW, dbn, temple } — عدد چاپ‌شده روی دسته. */
export function parseSize(str) {
  const m = String(str || "")
    .replace(/\s+/g, " ")
    .match(/(\d{2,3})\s*[□×x-]?\s*(\d{1,2})\s*[- ]?\s*(\d{2,3})/i);
  if (!m) return null;
  const lensW = +m[1], dbn = +m[2], temple = +m[3];
  if (lensW < 30 || lensW > 78 || dbn < 8 || dbn > 30 || temple < 95 || temple > 175) return null;
  return { lensW, dbn, temple };
}

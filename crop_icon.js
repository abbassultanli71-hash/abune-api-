const fs = require('fs');

const srcPath = 'C:/Users/Lenovo/.gemini/antigravity/brain/a9dd2432-6051-4274-9b91-3b9d0661cb7b/abunem_dedicated_mobile_app_icon_1785227011908.jpg';
const imgBuf = fs.readFileSync(srcPath);
const base64 = imgBuf.toString('base64');

// SVG that clips out 100% of the dark background and scales the orange squircle to fill 100% of the frame
const croppedSvg = `<svg viewBox="0 0 512 512" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <clipPath id="squircleClip">
    <rect x="0" y="0" width="512" height="512" rx="136"/>
  </clipPath>
  <g clip-path="url(#squircleClip)">
    <image href="data:image/jpeg;base64,${base64}" x="-78" y="-78" width="668" height="668"/>
  </g>
</svg>`;

fs.writeFileSync('public/icon.svg', croppedSvg);
console.log('Cropped SVG created successfully!');

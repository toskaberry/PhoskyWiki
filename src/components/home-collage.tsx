import Image from "next/image";
import styles from "./home-collage.module.css";

// Fixed brand artwork, deliberately independent of content/recommendation queries.
// Originals downloaded 2026-09-21; only CSS framing/grayscale and Next image resizing.
const portraits = [
  {
    name: "黑格尔", latin: "HEGEL", file: "hegel.jpg", width: 1700, height: 2151,
    source: "https://commons.wikimedia.org/wiki/File:Hegel_by_Schlesinger.jpg",
    credit: "Jakob Schlesinger，1831，柏林旧国家美术馆藏油画。",
    rights: "公有领域（PD-old / PD-US）", license: "https://creativecommons.org/publicdomain/mark/1.0/",
    crop: "灰度，居中截取头肩。", frame: styles.hegel,
  },
  {
    name: "马克思", latin: "MARX", file: "marx.jpg", width: 1280, height: 1500,
    source: "https://commons.wikimedia.org/wiki/File:Karl_Marx.jpg",
    credit: "John Jabez Edwin Mayall，1875，来源：阿姆斯特丹国际社会史研究所。",
    rights: "公有领域（PD-old）", license: "https://creativecommons.org/publicdomain/mark/1.0/",
    crop: "灰度，居中截取头肩。", frame: styles.marx,
  },
  {
    name: "拉康", latin: "LACAN", file: "lacan.jpg", width: 315, height: 501,
    source: "https://commons.wikimedia.org/wiki/File:Jacques_Lacan_during_an_interview_1969.jpg",
    credit: "Foto Moisio，1969 年采访照片，刊于 La Stampa（1969-11-07）。",
    rights: "公有领域（PD-Italy / PD-1996，依来源页标注）", license: "https://commons.wikimedia.org/wiki/File:Jacques_Lacan_during_an_interview_1969.jpg#Licensing",
    crop: "灰度，放大右上方头肩，裁去座椅及手部。", frame: styles.lacan,
  },
];

export function HomeCollage() {
  return (
    <figure className={styles.figure} aria-label="黑格尔、马克思、拉康与文献拼贴">
      <div className={styles.canvas}>
        <div className={styles.disc} aria-hidden="true">✳</div>
        <div className={styles.document}>
          <Image loading="eager" src="/home-collage/kapital.png" alt="《资本论》第一卷 1867 年扉页" width={1355} height={1984} sizes="(min-width: 1280px) 300px, 180px" />
        </div>
        <div className={styles.portraits}>
          {portraits.map(portrait => (
            <div key={portrait.file} className={`${styles.portrait} ${portrait.frame}`}>
              <div className={styles.crop}>
                <Image loading="eager" src={`/home-collage/${portrait.file}`} alt={`${portrait.name}肖像`} width={portrait.width} height={portrait.height} sizes="(min-width: 1280px) 180px, (min-width: 640px) 220px, 120px" />
              </div>
              <p className={styles.name}>{portrait.name}<span>{portrait.latin}</span></p>
            </div>
          ))}
        </div>
        <div className={styles.stripes} aria-hidden="true" />
      </div>
      <figcaption className="mt-3 text-xs leading-6 text-muted-foreground">
        <details>
          <summary className="w-fit cursor-pointer underline underline-offset-4">拼贴素材与来源</summary>
          <ul className="mt-3 space-y-3 border-t border-border pt-3">
            {portraits.map(portrait => (
              <li key={portrait.file}>
                <a href={portrait.source} className="underline">{portrait.name}肖像来源</a> · {portrait.credit}{" "}
                <a href={portrait.license} className="underline">{portrait.rights}</a>。{portrait.crop}
              </li>
            ))}
            <li>
              <a href="https://commons.wikimedia.org/wiki/File:Kapital_titel_bd1.png" className="underline">《资本论》扉页来源</a> · Karl Marx，1867；此图源自 Dietz Verlag Berlin 1973 年版所收扉页。{" "}
              <a href="https://creativecommons.org/publicdomain/mark/1.0/" className="underline">公有领域（PD-old）</a>。等比缩放、倾斜，部分被肖像遮盖，未改写文字。
            </li>
          </ul>
          <p className="mt-3">肖像与文献为固定视觉素材，页面裁切随屏幕调整，不代表推荐顺序。原文件保持不变，图像按显示尺寸优化。</p>
        </details>
      </figcaption>
    </figure>
  );
}

import { useId, useState } from 'react';
import { ShowroomPhoto } from './showroom-photo';

export const shoreDriveForecourtPhoto = '/api/website-assets/7934f681-e43a-4e8b-a812-2feb02de64e9';

/** Frame the original, published photograph around the cars without changing their pixels. */
export function ShoreDriveHeroPhoto({ src }: { src: string }) {
  const clip = useId();
  const rearClip = useId();
  const shadow = useId();
  const [failed, setFailed] = useState(false);
  const alt = 'Dark Audi SUV and silver Ford on the Shore Drive forecourt';

  if (failed) return <ShowroomPhoto src={src} alt={alt} priority className="mh-hero-photo" />;

  return (
    <svg
      className="mh-hero-photo mh-hero-photo--cutout"
      role="img"
      aria-label={alt}
      viewBox="674 299 698 308"
      width="698"
      height="308"
    >
      <defs>
        <clipPath id={clip}>
          <path d="M 686,513 Q 682,496 691,462 L 697,441 Q 712,422 740,409 L 777,394 Q 774,381 788,377 L 798,379 L 838,346 Q 866,328 885,324 Q 897,322 912,326 Q 958,321 1016,323 Q 1036,318 1053,323 Q 1080,328 1100,340 Q 1131,360 1149,390 Q 1161,412 1158,446 Q 1165,463 1162,487 L 1156,510 Q 1150,545 1138,551 Q 1122,558 1109,548 L 1098,525 L 1015,556 Q 1007,583 990,590 Q 968,597 950,590 Q 938,586 927,568 L 747,558 Q 736,572 717,570 Q 697,569 691,542 Q 684,536 686,513 Z" />
        </clipPath>
        <clipPath id={rearClip}>
          <path d="M 1163,390 Q 1169,372 1184,357 Q 1198,346 1226,341 Q 1268,338 1299,342 Q 1325,346 1337,356 Q 1351,365 1361,377 Q 1372,376 1375,384 L 1385,395 Q 1391,404 1390,418 L 1391,437 Q 1387,447 1378,450 Q 1374,459 1361,460 Q 1352,461 1348,455 L 1233,447 Q 1228,461 1218,460 Q 1205,460 1200,445 L 1177,436 Q 1173,447 1168,444 Q 1159,440 1160,423 Z" />
        </clipPath>
        <filter id={shadow}><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <g fill="#182235" opacity=".23" filter={`url(#${shadow})`}>
        <ellipse cx="918" cy="558" rx="214" ry="17" />
        <ellipse cx="1241" cy="516" rx="104" ry="9" />
      </g>
      <g transform="translate(-44 69)">
        <image href={src} width="1440" height="810" clipPath={`url(#${rearClip})`} />
      </g>
      <image href={src} width="1440" height="810" clipPath={`url(#${clip})`} onError={() => setFailed(true)} />
    </svg>
  );
}

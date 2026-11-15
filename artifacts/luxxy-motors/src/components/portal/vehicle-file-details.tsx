import { Gallery } from "@/components/gallery";
import { Camera } from "@/components/icons";
import type { Car } from "@/lib/stock-context";
import { getSafeImageUrl, vehicleDisplayTitle } from "@/lib/utils";
import { orderVehiclePhotos } from "@/lib/vehicle-photography";
import { VehicleInformationBody } from "./enquiry-vehicle-information";
import { VehicleFileSavedPhotos } from "./vehicle-file-saved-photos";
import "./vehicle-file-details.css";

export function VehicleFilePhotos({ car }: { car: Car }) {
  const title = vehicleDisplayTitle(car);
  const heroImage = car.heroImage ? getSafeImageUrl(car.heroImage) || null : null;
  const photoCount = orderVehiclePhotos(car.images, heroImage).length;

  return (
    <section className="vehicle-file-photos" aria-label="Vehicle photographs">
      <header className="vehicle-file-photos-heading">
        <h3>Vehicle photographs</h3>
        {photoCount > 0 && (
          <span>{photoCount} {photoCount === 1 ? "photo" : "photos"}</span>
        )}
      </header>
      {photoCount > 0 ? (
        <Gallery
          key={car.id}
          images={car.images}
          heroImage={heroImage}
          vehicleLabel={title}
          customerView
        />
      ) : (
        <p className="vehicle-file-photos-empty">
          <Camera aria-hidden="true" size={20} /> No advert photographs saved for this vehicle.
        </p>
      )}
      <VehicleFileSavedPhotos key={car.id} vehicleId={car.id} />
    </section>
  );
}

export function VehicleFileDetails({ car }: { car: Car }) {
  return (
    <div className="vehicle-file-details">
      <VehicleInformationBody
        car={car}
        includeMot={false}
        published={false}
        layout="file"
      />
    </div>
  );
}

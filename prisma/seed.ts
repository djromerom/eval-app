import { PrismaClient, RoleType } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seed de desarrollo: una institución demo con un super admin, el año
 * académico actual y un catálogo mínimo de asignaturas. Idempotente
 * (usa upsert por claves únicas) para poder correrlo varias veces.
 *
 * Ejecutar: pnpm db:seed
 */
const prisma = new PrismaClient();

const DEMO_INSTITUTION = {
  name: "I.E. María Doraliza López de Mejía",
  slug: "maria-doraliza",
  code: "MDLM",
};

// Catálogo global de asignaturas (institutionId = null): las áreas ICFES.
const GLOBAL_SUBJECTS = [
  { name: "Matemáticas", code: "MAT", icon: "calculator" },
  { name: "Lenguaje", code: "LEN", icon: "book-open" },
  { name: "Ciencias Naturales", code: "CNA", icon: "flask-conical" },
  { name: "Ciencias Sociales", code: "CSO", icon: "globe" },
  { name: "Inglés", code: "ING", icon: "languages" },
];

async function main() {
  const institution = await prisma.institution.upsert({
    where: { slug: DEMO_INSTITUTION.slug },
    update: {},
    create: DEMO_INSTITUTION,
  });
  console.log(`✔ Institución: ${institution.name} (${institution.code})`);

  const email = "admin@eval.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Super Administrador",
      password: passwordHash,
      institutionId: institution.id,
      // Roles combinables (§2): la cuenta demo lleva los 4 roles para poder
      // recorrer todos los paneles (admin, coordinador, docente) con un login.
      roles: {
        create: [{ role: RoleType.SUPER_ADMIN }],
      },
    },
  });
  // Idempotencia: asegura todos los roles aunque el usuario ya existiera.
  for (const role of [RoleType.ADMIN, RoleType.COORDINATOR, RoleType.TEACHER]) {
    await prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role } },
      update: {},
      create: { userId: admin.id, role },
    });
  }
  console.log(`✔ Usuario demo (4 roles): ${admin.email} (contraseña: ${password})`);

  const currentYear = new Date().getFullYear();
  const academicYear = await prisma.academicYear.upsert({
    where: { institutionId_year: { institutionId: institution.id, year: currentYear } },
    update: { isCurrent: true },
    create: {
      year: currentYear,
      institutionId: institution.id,
      startDate: new Date(currentYear, 0, 15),
      endDate: new Date(currentYear, 10, 30),
      isCurrent: true,
    },
  });
  console.log(`✔ Año académico: ${academicYear.year}`);

  for (const subject of GLOBAL_SUBJECTS) {
    const existing = await prisma.subject.findFirst({
      where: { code: subject.code, institutionId: null },
    });
    if (!existing) {
      await prisma.subject.create({ data: subject });
    }
  }
  console.log(`✔ Asignaturas globales: ${GLOBAL_SUBJECTS.map((s) => s.code).join(", ")}`);

  console.log("\nSeed completado.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

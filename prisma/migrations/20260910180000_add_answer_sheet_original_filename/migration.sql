-- Nombre del archivo tal como lo subio el usuario.
-- La subida renombra los escaneos a sheet_NNN.ext, asi que hasta ahora no
-- quedaba forma de rastrear una hoja hasta el archivo que salio del escaner.
-- Nullable a proposito: los lotes ya cargados perdieron el nombre original y
-- no hay manera de recuperarlo.
ALTER TABLE "AnswerSheet" ADD COLUMN "originalFilename" TEXT;

-- SIMUB · Nuevo rol «campo»: celular o tableta de una unidad (o de un bombero) para registrar desde el lugar.
alter type rol_panel add value if not exists 'campo';

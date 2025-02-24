const Entity = require('./entity');

const table = `create table if not exists download (
  id integer primary key,
  client_ip text not null,
  package_name text not null,
  plugin_id text not null,
  device_id text not null,
  created_at timestamp default current_timestamp,
  foreign key (plugin_id) references plugin(id)
);`;

class Download extends Entity {
  ID = 'id';
  PLUGIN_ID = 'plugin_id';
  DEVICE_ID = 'device_id';
  CREATED_AT = 'created_at';
  CLIENT_IP = 'client_ip';
  PACKAGE_NAME = 'package_name';

  constructor() {
    super(table);
  }

  get columns() {
    return [this.ID, this.PLUGIN_ID, this.DEVICE_ID, this.CREATED_AT, this.CLIENT_IP, this.PACKAGE_NAME];
  }
}

module.exports = new Download();
